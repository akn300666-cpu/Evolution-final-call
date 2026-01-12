import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { sendMessageToEve, startChatWithHistory, generateVisualSelfie, summarizeConversation, EveResponse } from './services/geminiService';
import { 
    saveSession, loadSession, clearSession, 
    loadApiKeys, saveApiKeys, loadActiveKeyId, saveActiveKeyId, 
    loadGradioEndpoint, saveGradioEndpoint,
    loadGenerationSettings, saveGenerationSettings, GenerationSettingsDefaults,
    saveLanguage, loadLanguage
} from './services/storageService';
import { AVAILABLE_CHAT_MODELS } from './constants';
import { Message, ApiKeyDef, GenerationSettings, Language } from './types';
import ChatBubble from './components/ChatBubble';
import VisualAvatar from './components/VisualAvatar';

type KeyStatus = 'untested' | 'testing' | 'valid' | 'invalid';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<string[]>([]);
  const [language, setLanguage] = useState<Language>(() => loadLanguage());
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isImageEvolutionMode, setIsImageEvolutionMode] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<'neutral' | 'happy' | 'cheeky' | 'angry' | 'smirking' | 'seductive'>('neutral');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [visualMemory, setVisualMemory] = useState<string>("");
  const [apiKeys, setApiKeys] = useState<ApiKeyDef[]>(() => loadApiKeys());
  const [activeKeyId, setActiveKeyId] = useState<string | null>(() => loadActiveKeyId());
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [gradioEndpoint, setGradioEndpoint] = useState<string | null>(() => loadGradioEndpoint());
  const [tempGradioEndpoint, setTempGradioEndpoint] = useState<string>(gradioEndpoint || '');
  const [genSettings, setGenSettings] = useState<GenerationSettings>(() => loadGenerationSettings());
  const [pendingLanguage, setPendingLanguage] = useState<Language | null>(null); 
  const [toast, setToast] = useState<{message: string, type: 'info' | 'error' | 'success'} | null>(null);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatus>>({});
  const [tokenCount, setTokenCount] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isConsolidating, setIsConsolidating] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hydrationAttempted = useRef(false);

  useEffect(() => {
      const initialStatuses: Record<string, KeyStatus> = {};
      apiKeys.forEach(key => {
          initialStatuses[key.id] = 'untested';
      });
      setKeyStatuses(initialStatuses);
  }, [apiKeys]);

  useEffect(() => {
    if (isLoaded && messages.length > 1) {
        const activeMessages = messages.slice(-(genSettings.historyDepth || 20));
        const totalChars = activeMessages.reduce((acc, msg) => acc + (msg.text?.length || 0), 0);
        const estimatedTokens = Math.round(totalChars / 4) + (activeMessages.filter(m => !!m.image).length * 258);
        setTokenCount(estimatedTokens);
    } else {
        setTokenCount(0);
    }
  }, [messages, isLoaded, genSettings.historyDepth]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, attachment, isLoaded]);

  useEffect(() => {
    if (hydrationAttempted.current) return;
    hydrationAttempted.current = true;

    const hydrate = async () => {
      try {
        const session = await loadSession();
        const savedLanguage = loadLanguage();
        setLanguage(savedLanguage);
        let awayDurationString = "";
        
        if (session) {
          setMessages(session.messages || []);
          setMemories(session.memories || []);
          setLastSaved(new Date(session.lastUpdated));
          
          const diffMs = Date.now() - session.lastUpdated;
          const diffSec = Math.floor(diffMs / 1000);
          const diffMin = Math.floor(diffSec / 60);
          const diffHr = Math.floor(diffMin / 60);
          
          if (diffHr > 0) awayDurationString = `${diffHr} hours and ${diffMin % 60} minutes`;
          else if (diffMin > 0) awayDurationString = `${diffMin} minutes`;
          else if (diffSec > 10) awayDurationString = `${diffSec} seconds`;

          const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
          startChatWithHistory(session.messages, activeKeyDef?.key, genSettings, awayDurationString, savedLanguage, session.memories);
        } else {
          setMessages([{ id: 'welcome', role: 'model', text: savedLanguage === 'manglish' ? `Hey, enthaanu വിശേഷം?` : `Hello World` }]);
          startChatWithHistory([], undefined, genSettings, undefined, savedLanguage, []);
        }
      } catch (e) {
        setMessages([{ id: 'welcome_error', role: 'model', text: `Fresh start.` }]);
      } finally {
        setIsLoaded(true);
      }
    };
    hydrate();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    saveSession(messages, memories).then(() => setLastSaved(new Date()));
  }, [messages, memories, isLoaded]);

  // AUTOMATIC MEMORY CONSOLIDATION
  useEffect(() => {
    if (!isLoaded || isConsolidating) return;
    const threshold = (genSettings.historyDepth || 20) + 10;
    if (messages.length > threshold) {
        consolidateMemories();
    }
  }, [messages, isLoaded]);

  const consolidateMemories = async () => {
    setIsConsolidating(true);
    try {
        const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
        const toSummarize = messages.slice(0, 10);
        const summary = await summarizeConversation(toSummarize, activeKeyDef?.key, language);
        if (summary) {
            setMemories(prev => [summary, ...prev].slice(0, 15)); // Keep last 15 core memories
            setMessages(prev => prev.slice(10)); // Prune the history
            showToast("Eve updated her core memories.", "info");
        }
    } catch (e) {
        console.error("Consolidation error", e);
    } finally {
        setIsConsolidating(false);
    }
  };

  const showToast = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const initiateLanguageChange = (newLang: Language) => {
    if (newLang === language) return;
    if (messages.length <= 1) {
        performLanguageChange(newLang);
    } else {
        setPendingLanguage(newLang);
    }
  };

  const confirmLanguageChange = () => {
    if (pendingLanguage) {
        performLanguageChange(pendingLanguage);
        setPendingLanguage(null);
    }
  };

  const cancelLanguageChange = () => {
    setPendingLanguage(null);
  };

  const performLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    saveLanguage(newLang);
    const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);

    if (messages.length <= 1) {
        const welcomeMessage = newLang === 'manglish' ? "Enthaanu... നമുക്ക് ഒന്നൂടെ തുടങ്ങാം." : "Okay, let's start over.";
        setMessages([{ id: 'reset', role: 'model', text: welcomeMessage }]);
        startChatWithHistory([], activeKeyDef?.key, genSettings, undefined, newLang, memories);
    } else {
        startChatWithHistory(messages, activeKeyDef?.key, genSettings, undefined, newLang, memories);
        showToast(`Persona switched to ${newLang === 'english' ? 'English' : 'Manglish'}.`, 'success');
    }
    
    setVisualMemory("");
  };

  const handleClearHistory = () => {
    const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
    const welcomeMessage = language === 'manglish' ? "Namukku puthiyathayi thudangaam." : "Let's start a new chapter.";
    setMessages([{ id: 'fresh_start', role: 'model', text: welcomeMessage }]);
    setMemories([]); // Clear long-term memories too
    startChatWithHistory([], activeKeyDef?.key, genSettings, undefined, language, []);
    setVisualMemory("");
    clearSession();
    setShowClearConfirm(false);
    showToast("Memory cleared. Fresh start!", 'success');
  };
  
  const handleAddKey = () => {
    if (!newKeyLabel.trim() || !newKeyValue.trim()) return;
    const newKey = { id: Date.now().toString(), label: newKeyLabel.trim(), key: newKeyValue.trim() };
    const updated = [...apiKeys, newKey];
    setApiKeys(updated);
    saveApiKeys(updated);
    setKeyStatuses(prev => ({...prev, [newKey.id]: 'untested' }));
    if (updated.length === 1) { setActiveKeyId(newKey.id); saveActiveKeyId(newKey.id); }
    setNewKeyLabel(''); setNewKeyValue('');
    showToast('API Key added.', 'success');
  };

  const handleTestKey = async (keyId: string) => {
      const keyToTest = apiKeys.find(k => k.id === keyId);
      if (!keyToTest) return;
      setKeyStatuses(prev => ({ ...prev, [keyId]: 'testing' }));
      try {
          const ai = new GoogleGenAI({ apiKey: keyToTest.key });
          await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: 'test' });
          setKeyStatuses(prev => ({ ...prev, [keyId]: 'valid' }));
          showToast(`Key "${keyToTest.label}" is valid!`, 'success');
      } catch (error) {
          setKeyStatuses(prev => ({ ...prev, [keyId]: 'invalid' }));
          showToast(`Key test failed.`, 'error');
      }
  };

  const handleSaveGradio = () => {
    const trimmedUrl = tempGradioEndpoint.trim();
    saveGradioEndpoint(trimmedUrl);
    setGradioEndpoint(trimmedUrl);
    showToast('Gradio endpoint updated', 'success');
  };

  const handleGenSettingChange = (key: keyof GenerationSettings, value: number | boolean | string) => {
    const updated = { ...genSettings, [key]: value };
    setGenSettings(updated);
    saveGenerationSettings(updated);
  };
  
  const resetSetting = (key: keyof GenerationSettings) => {
    handleGenSettingChange(key, GenerationSettingsDefaults[key]);
  };
  
  const handleSendMessage = async () => {
    if ((!inputText.trim() && !attachment) || isThinking) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: inputText, image: attachment || undefined };
    setMessages((prev) => [...prev, userMsg]);
    const currentAttachment = attachment;
    const historySnapshot = [...messages, userMsg];
    setInputText(''); setAttachment(null); setIsThinking(true); setCurrentEmotion('neutral');
    
    const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
    try {
        const response = await sendMessageToEve(
            userMsg.text, historySnapshot, currentAttachment || undefined, false,
            activeKeyDef?.key, gradioEndpoint, genSettings, visualMemory, language, memories
        );
        
        if (response.isError) {
            // Updated: Use the specific text returned by the service
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: response.text, isError: true }]);
        } else {
            const mId = Date.now().toString();
            setMessages(prev => [...prev, { id: mId, role: 'model', text: response.text, image: response.image, isImageLoading: !!response.visualPrompt }]);
            if (response.visualPrompt) {
                generateVisualSelfie(response.visualPrompt, activeKeyDef?.key, gradioEndpoint, genSettings, visualMemory, response.visualType)
                .then(res => {
                    if (res?.imageUrl) setMessages(prev => prev.map(m => m.id === mId ? { ...m, image: res.imageUrl, isImageLoading: false } : m));
                    else setMessages(prev => prev.map(m => m.id === mId ? { ...m, isImageLoading: false } : m));
                }).catch(() => setMessages(prev => prev.map(m => m.id === mId ? { ...m, isImageLoading: false } : m)));
            }
        }
    } catch (e) {
        // Updated: Only show "Signal lost" if the catch block itself is hit
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Critical connection failure. Please refresh.", isError: true }]);
    } finally {
        setIsThinking(false);
    }
  };
  
  const SettingsSlider = ({ label, value, min, max, step, settingKey }: { label: string; value: number; min: number; max: number; step: number; settingKey: keyof GenerationSettings; }) => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-slate-200 bg-indigo-600 px-3 py-1 rounded-md shadow-sm">{label}</label>
        <div className="flex items-center gap-2 bg-slate-800 rounded-md px-2 border border-slate-700">
          <input type="number" step={step} value={value} onChange={(e) => handleGenSettingChange(settingKey, parseFloat(e.target.value))} className="w-16 bg-transparent text-slate-200 text-sm text-center focus:outline-none" />
          <button onClick={() => resetSetting(settingKey)} className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => handleGenSettingChange(settingKey, parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
    </div>
  );

  const KeyStatusIndicator: React.FC<{status: KeyStatus}> = ({status}) => {
    const statusMap = {
      untested: { text: 'Untested', color: 'text-slate-500' },
      testing: { text: 'Testing...', color: 'text-amber-500 animate-pulse' },
      valid: { text: 'Valid', color: 'text-emerald-500' },
      invalid: { text: 'Invalid', color: 'text-red-500' },
    };
    return <span className={`text-xs font-medium ${statusMap[status].color}`}>{statusMap[status].text}</span>;
  };

  const SidebarContent = () => (
    <>
      <div className="bg-slate-900 rounded-lg p-1 border border-slate-800 flex relative mb-6">
        <button onClick={() => initiateLanguageChange('english')} className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-300 z-10 ${language === 'english' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>English</button>
        <button onClick={() => initiateLanguageChange('manglish')} className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-300 z-10 ${language === 'manglish' ? 'bg-fuchsia-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>Manglish</button>
      </div>

       <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
        {/* NEW: Memory Vault Section */}
        <details className="bg-slate-900/50 rounded-lg border border-slate-800 text-sm" open={memories.length > 0}>
          <summary className="p-4 font-medium cursor-pointer flex justify-between items-center group">
              <span>Memory Vault</span>
              {isConsolidating && <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>}
          </summary>
          <div className="p-4 border-t border-slate-800 space-y-3">
              {memories.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic text-center py-4">No core memories established yet...</p>
              ) : (
                  memories.map((m, i) => (
                      <div key={i} className="p-2 bg-indigo-950/20 border border-indigo-500/20 rounded text-[11px] leading-relaxed text-indigo-200/80 italic animate-fade-in">
                          "{m}"
                      </div>
                  ))
              )}
          </div>
        </details>

        <details className="bg-slate-900/50 rounded-lg border border-slate-800 text-sm">
          <summary className="p-4 font-medium cursor-pointer">Session Info</summary>
          <div className="p-4 border-t border-slate-800 space-y-4">
              <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-400">Tokens (est)</span>
                  <span className={`font-mono font-bold ${tokenCount > 10000 ? 'text-amber-500' : 'text-slate-300'}`}>{tokenCount.toLocaleString()}</span>
              </div>
              <button onClick={() => setShowClearConfirm(true)} className="w-full flex items-center justify-center gap-2 text-xs font-semibold py-2 bg-red-900/50 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-800 transition-colors">Wipe Memory</button>
          </div>
        </details>
        
        <details className="bg-slate-900/50 rounded-lg p-4 border border-slate-800 space-y-6 text-sm" open>
          <summary className="font-medium cursor-pointer -m-4 p-4">Visual Generation</summary>
          <div className="pt-4 mt-4 border-t border-slate-800 space-y-6">
            <label className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700 cursor-pointer">
              <span className="font-medium text-slate-200">AI Image Generation</span>
              <div className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={genSettings.aiImageGeneration} onChange={(e) => handleGenSettingChange('aiImageGeneration', e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-700 rounded-full peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
              </div>
            </label>
            <SettingsSlider label="Likeness Strength" value={genSettings.ipAdapterStrength} min={0} max={1} step={0.05} settingKey="ipAdapterStrength" />
            <SettingsSlider label="Guidance" value={genSettings.guidance} min={1} max={15} step={0.01} settingKey="guidance" />
            <SettingsSlider label="Steps" value={genSettings.steps} min={20} max={50} step={1} settingKey="steps" />
          </div>
        </details>

        <details className="bg-slate-900/50 rounded-lg border border-slate-800 text-sm" open>
            <summary className="p-4 font-medium cursor-pointer">Connections</summary>
            <div className="p-4 border-t border-slate-800 space-y-6">
                <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">Gradio Endpoint</label>
                    <div className="flex items-center gap-2">
                        <input type="text" placeholder="URL" value={tempGradioEndpoint} onChange={(e) => setTempGradioEndpoint(e.target.value)} className="flex-1 bg-slate-800 rounded-md p-2 border border-slate-700 text-xs" />
                        <button onClick={handleSaveGradio} className="bg-indigo-600 text-white px-3 py-2 rounded-md text-xs font-bold">Save</button>
                    </div>
                </div>
                <div className="space-y-3 pt-4 border-t border-slate-700/50">
                    <label className="text-xs font-medium text-slate-300">Gemini API Keys</label>
                    {apiKeys.map(k => (
                        <div key={k.id} className={`grid grid-cols-[1fr,auto,auto] items-center gap-2 p-1.5 rounded text-xs transition-colors ${activeKeyId === k.id ? 'bg-indigo-900/20 border border-fuchsia-500/30' : 'bg-slate-800/50'}`}>
                            <div className="flex items-center gap-2 cursor-pointer" onClick={() => {setActiveKeyId(k.id); saveActiveKeyId(k.id);}}>
                                <div className={`w-2 h-2 rounded-full ${activeKeyId === k.id ? 'bg-fuchsia-500' : 'bg-slate-600'}`}></div>
                                <span className="truncate">{k.label}</span>
                            </div>
                            <KeyStatusIndicator status={keyStatuses[k.id] || 'untested'} />
                            <button onClick={() => handleTestKey(k.id)} className="text-[10px] bg-slate-700 px-2 py-1 rounded">Test</button>
                        </div>
                    ))}
                    <div className="flex gap-1">
                      <input type="password" placeholder="New Key" value={newKeyValue} onChange={e=>setNewKeyValue(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs"/>
                      <button onClick={handleAddKey} className="bg-slate-700 px-3 rounded text-xs font-bold">+</button>
                    </div>
                </div>
            </div>
        </details>
        
        <details className="bg-slate-900/50 rounded-lg border border-slate-800 text-sm" open>
            <summary className="p-4 font-medium cursor-pointer">Intelligence Config</summary>
            <div className="p-4 border-t border-slate-800 space-y-6">
              <select value={genSettings.chatModel} onChange={(e) => handleGenSettingChange('chatModel', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm">
                  {AVAILABLE_CHAT_MODELS.map(model => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
              </select>
              <SettingsSlider label="Memory Depth" value={genSettings.historyDepth || 20} min={5} max={50} step={1} settingKey="historyDepth" />
              <SettingsSlider label="Creativity" value={genSettings.temperature} min={0} max={2} step={0.05} settingKey="temperature" />
            </div>
        </details>
      </div>
    </>
  );

  if (!isLoaded) return <div className="h-screen w-full bg-[#0a0510] flex items-center justify-center text-slate-500 animate-pulse font-serif italic text-xl">Re-connecting...</div>;

  return (
    <div className="relative flex flex-col md:flex-row h-[100dvh] w-full bg-[#0a0510] text-slate-200 overflow-hidden" style={{backgroundColor: '#202123'}}>
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-20">
          <img src="https://res.cloudinary.com/dy57jxan6/image/upload/v1767379881/nano-canvas-1767379657904_u94i4b.png" className="w-full h-full object-cover blur-[2px]" alt="Background" />
      </div>

      {toast && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[80] px-6 py-3 rounded-full bg-indigo-900 border border-indigo-500 text-white text-xs animate-fade-in">{toast.message}</div>}

      {pendingLanguage && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full animate-fade-in">
                <h3 className="text-lg font-bold mb-2">Switch Persona?</h3>
                <div className="flex gap-3 mt-6">
                    <button onClick={cancelLanguageChange} className="flex-1 py-2 rounded-lg bg-slate-800 text-sm">Cancel</button>
                    <button onClick={confirmLanguageChange} className="flex-1 py-2 rounded-lg bg-fuchsia-600 text-sm">Switch</button>
                </div>
            </div>
        </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full animate-fade-in">
                <h3 className="text-lg font-bold mb-2 text-red-400">Wipe Memories?</h3>
                <p className="text-slate-400 text-sm mb-6">This will permanently delete the session and core memories.</p>
                <div className="flex gap-3">
                    <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-2 rounded-lg bg-slate-800 text-sm">Cancel</button>
                    <button onClick={handleClearHistory} className="flex-1 py-2 rounded-lg bg-red-600 text-sm">Wipe</button>
                </div>
            </div>
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
        </div>
      )}

      <div className="fixed top-0 left-0 w-full h-16 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 z-50 flex items-center justify-between px-4 md:hidden">
        <h1 className="text-sm font-serif font-bold">EVE <span className="text-fuchsia-500 text-[10px]">v2.1</span></h1>
        <div className="absolute left-1/2 -translate-x-1/2 top-4"><VisualAvatar isThinking={isThinking} emotion={currentEmotion}/></div>
        <button onClick={() => setMobileMenuOpen(true)} className="p-2 text-slate-400"><svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg></button>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-xl p-6 md:hidden animate-fade-in flex flex-col">
          <button onClick={() => setMobileMenuOpen(false)} className="self-end p-2 mb-8 text-slate-400"><svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6" /></svg></button>
          <SidebarContent />
        </div>
      )}

      <div className="hidden md:flex md:w-80 md:flex-col md:border-r md:border-slate-800 md:p-8 bg-slate-900/90 backdrop-blur-xl z-40 overflow-hidden">
        <div className="flex flex-col items-center gap-6 shrink-0"><VisualAvatar isThinking={isThinking} emotion={currentEmotion}/><h1 className="text-xl font-serif font-bold">EVE <span className="text-fuchsia-500 text-xs">v2.1</span></h1></div>
        <div className="mt-8 flex-1 overflow-hidden"><SidebarContent /></div>
      </div>

      <div className="flex-1 flex flex-col relative pt-16 md:pt-0 overflow-hidden z-10">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth custom-scrollbar">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} onImageClick={setPreviewImage}/>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="relative p-4 md:p-8 border-t border-slate-800 bg-slate-900/90 backdrop-blur-xl z-30">
          <div className="flex items-end gap-3 md:gap-4">
            <textarea value={inputText} onChange={e=>setInputText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault(); handleSendMessage();}}} placeholder={isThinking ? "EVE is processing..." : "Connect with EVE..."} className="flex-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-3 text-sm focus:outline-none focus:border-fuchsia-500/50 resize-none max-h-40 text-slate-100 placeholder:text-slate-500" rows={1} disabled={isThinking}/>
            <button onClick={handleSendMessage} className={`p-3 rounded-full text-white transition-all ${(!inputText.trim() && !attachment) || isThinking ? 'bg-slate-800 text-slate-600' : 'bg-gradient-to-r from-fuchsia-600 to-purple-600 shadow-lg shadow-fuchsia-500/20 active:scale-95'}`} disabled={(!inputText.trim() && !attachment) || isThinking}>
              {isThinking ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <svg className="h-7 w-7 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
