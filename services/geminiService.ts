
import { GoogleGenAI, Chat, GenerateContentResponse, HarmCategory, HarmBlockThreshold, Content } from "@google/genai";
import { EVE_SYSTEM_INSTRUCTION, EVE_MANGLISH_SYSTEM_INSTRUCTION, MODELS } from '../constants';
import { Message, GenerationSettings, Language } from '../types';

let chatSession: Chat | null = null;
let currentLanguage: Language = 'english';
let currentChatModel: string | null = null;
let currentMemories: string[] = [];

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const IMAGE_QUALITY_SUFFIX = ", 8k, best quality, masterpiece";

const getTimeAwareSystemInstruction = (awayDurationString?: string, language: Language = 'english', memories: string[] = []) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    let temporalInfo = language === 'english' 
        ? `\n[Context: ${dateStr}, ${timeStr}]` 
        : `\n[Samayam: ${dateStr}, ${timeStr}]`;

    if (awayDurationString) {
        temporalInfo += language === 'english' 
            ? ` (User returned after ${awayDurationString})`
            : ` (User ${awayDurationString} aayirunnu offline)`;
    }

    let memoryBlock = "";
    if (memories.length > 0) {
        memoryBlock = language === 'english' 
            ? `\n\n**LONG-TERM MEMORIES:**\n${memories.map(m => `• ${m}`).join('\n')}`
            : `\n\n**ORMMAKURAIPPUKAL:**\n${memories.map(m => `• ${m}`).join('\n')}`;
    }

    const baseInstruction = language === 'manglish' ? EVE_MANGLISH_SYSTEM_INSTRUCTION : EVE_SYSTEM_INSTRUCTION;
    return `${baseInstruction}${temporalInfo}${memoryBlock}`;
};

const formatHistoryForGemini = (history: Message[], depth: number = 20): Content[] => {
    const validHistory: Content[] = [];
    const trimmedHistory = history.length > depth ? history.slice(-depth) : history;

    if (trimmedHistory && trimmedHistory.length > 0) {
        for (const h of trimmedHistory) {
            if (h.isError) continue;
            if (h.role === 'user') {
                const parts: any[] = [];
                if (h.image && h.image.startsWith('data:')) {
                    const mt = (h.image.match(/^data:(.*);base64,/) || [])[1];
                    const d = h.image.replace(/^data:image\/\w+;base64,/, "");
                    if (d && mt) parts.push({ inlineData: { mimeType: mt, data: d } });
                }
                if (h.text) parts.push({ text: h.text });
                if (parts.length > 0) validHistory.push({ role: 'user', parts });
            } else {
                validHistory.push({ role: 'model', parts: [{ text: h.text || "..." }] });
            }
        }
    }

    const merged: Content[] = [];
    if (validHistory.length > 0) {
        let current = { ...validHistory[0] };
        for (let i = 1; i < validHistory.length; i++) {
            if (validHistory[i].role === current.role) {
                current.parts.push(...validHistory[i].parts);
            } else {
                merged.push(current);
                current = { ...validHistory[i] };
            }
        }
        merged.push(current);
    }
    while (merged.length > 0 && merged[0].role === 'model') merged.shift();
    return merged;
};

export const initializeChat = (history: Message[] = [], apiKey?: string, settings?: GenerationSettings, awayDurationString?: string, language: Language = 'english', memories: string[] = []) => {
  currentLanguage = language;
  const modelToUse = settings?.chatModel || MODELS.chat;
  currentChatModel = modelToUse;
  currentMemories = memories;
  
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const formattedHistory = formatHistoryForGemini(history, settings?.historyDepth);
    const systemInstruction = getTimeAwareSystemInstruction(awayDurationString, language, memories);

    chatSession = ai.chats.create({
      model: modelToUse,
      config: {
        systemInstruction: systemInstruction,
        temperature: settings?.temperature ?? 1.0,
        topP: settings?.topP ?? 0.95,
        topK: settings?.topK ?? 40,
        safetySettings: SAFETY_SETTINGS,
      },
      history: formattedHistory,
    });
  } catch (error) {
    chatSession = null;
    console.error("Chat Initialization Failed:", error);
  }
};

export interface EveResponse {
    text: string;
    image?: string;
    visualPrompt?: string;
    visualType?: 'scene' | 'selfie';
    isError?: boolean;
    errorMessage?: string;
    errorType?: 'QUOTA_EXCEEDED' | 'AUTH_ERROR' | 'GENERAL'; 
    enhancedPrompt?: string;
}

export const sendMessageToEve = async (
  message: string, 
  history: Message[],
  attachmentBase64: string | undefined,
  forceImageGeneration: boolean = false,
  apiKey: string | undefined,
  gradioEndpoint: string | null | undefined,
  genSettings: GenerationSettings,
  previousVisualContext: string = "",
  language: Language = 'english',
  memories: string[] = []
): Promise<EveResponse> => {
  const chatModel = genSettings.chatModel || MODELS.chat;

  if (!chatSession || currentLanguage !== language || currentChatModel !== chatModel || currentMemories.length !== memories.length) {
    initializeChat(history, undefined, genSettings, undefined, language, memories);
  }

  if (!chatSession) {
    return { 
      text: "Connection failed. Please check your API key and billing status.", 
      isError: true, 
      errorMessage: "Chat session failed to initialize. Likely invalid key or model access." 
    };
  }

  const mimeType = attachmentBase64 ? (attachmentBase64.match(/^data:(.*);base64,/) || [])[1] || 'image/jpeg' : 'image/jpeg';
  const cleanBase64 = attachmentBase64 ? attachmentBase64.replace(/^data:image\/\w+;base64,/, "") : null;

  try {
    let msgContent: any = message;
    if (attachmentBase64) {
      msgContent = { parts: [{ inlineData: { data: cleanBase64!, mimeType } }, { text: message }] };
    }

    const result: GenerateContentResponse = await chatSession.sendMessage({ message: msgContent });
    let replyText = result.text || "";

    const selfieMatch = replyText.match(/\[SELFIE(?::\s*(.*?))?\]/);
    const sceneMatch = replyText.match(/\[SCENE(?::\s*(.*?))?\]/);
    
    let visualPrompt: string | undefined;
    let visualType: 'scene' | 'selfie' = 'scene';
    
    if (genSettings.aiImageGeneration) {
        if (selfieMatch) {
          visualPrompt = selfieMatch[1] || "portrait of Eve";
          visualType = 'selfie';
        } else if (sceneMatch) {
            visualPrompt = sceneMatch[1] || "a scenic POV";
            visualType = 'scene';
        }
    }

    replyText = replyText.replace(/\[SELFIE(?::\s*.*?)?\]/g, "").replace(/\[SCENE(?::\s*.*?)?\]/g, "").trim();
    return { text: replyText, visualPrompt, visualType };

  } catch (error: any) {
    chatSession = null; // Reset session on error to force re-init next time
    const errStr = String(error);
    let userFriendlyError = "Signal lost. The connection to Gemini was interrupted.";
    
    if (errStr.includes("403") || errStr.includes("permission")) {
        userFriendlyError = "Access denied. Your API key might not have permission for this model, or billing is required.";
    } else if (errStr.includes("429")) {
        userFriendlyError = "Too many messages. Please wait a moment before sending again.";
    } else if (errStr.includes("404")) {
        userFriendlyError = "Model not found. Please try a different chat model in settings.";
    }

    return { text: userFriendlyError, isError: true, errorMessage: errStr };
  }
};

// Fixed: Implemented missing generateVisualSelfie export to resolve the build error in App.tsx
export const generateVisualSelfie = async (
  prompt: string,
  apiKey: string | undefined,
  gradioEndpoint: string | null | undefined,
  genSettings: GenerationSettings,
  visualContext: string,
  visualType?: 'scene' | 'selfie'
): Promise<{ imageUrl: string } | null> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    // Use the default image generation model gemini-2.5-flash-image
    const model = MODELS.image; 

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            text: `${visualType === 'selfie' ? 'Selfie of Eve: ' : 'Scene from user POV: '}${prompt}${IMAGE_QUALITY_SUFFIX}`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "9:16",
        },
      },
    });

    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        // Find the image part in the response
        if (part.inlineData) {
          const base64EncodeString: string = part.inlineData.data;
          return { imageUrl: `data:${part.inlineData.mimeType};base64,${base64EncodeString}` };
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Visual generation error:", error);
    return null;
  }
};

export const summarizeConversation = async (
  historyToSummarize: Message[],
  apiKey?: string,
  language: Language = 'english'
): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = language === 'english' ? 
            `Summarize these messages into a single, first-person memory for Eve's long-term consciousness. Format: "I remember [Action/Fact] and it made me feel [Emotion]." Keep it under 20 words.` 
            : `Ee chat memories oru sentence aayi summarize cheyyuka. Eveyude perspective aayirikkanam. Max 20 words. Manglish mathram.`;

        const response = await ai.models.generateContent({
            model: MODELS.chat,
            contents: `${prompt}\nLogs: ${historyToSummarize.map(m => `${m.role}:${m.text}`).join('|')}`,
            config: { temperature: 0.3, safetySettings: SAFETY_SETTINGS }
        });
        return response.text?.trim() || "";
    } catch (e) {
        return "";
    }
};

export const startChatWithHistory = async (history: Message[], apiKey?: string, settings?: GenerationSettings, awayDurationString?: string, language: Language = 'english', memories: string[] = []) => {
  initializeChat(history, undefined, settings, awayDurationString, language, memories);
};
