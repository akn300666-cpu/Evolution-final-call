import { GoogleGenAI, Chat, GenerateContentResponse, HarmCategory, HarmBlockThreshold, Content } from "@google/genai";
import { EVE_SYSTEM_INSTRUCTION, EVE_MANGLISH_SYSTEM_INSTRUCTION, MODELS } from '../constants';
import { Message, GenerationSettings, Language } from '../types';

let chatSession: Chat | null = null;
let currentLanguage: Language = 'english';
let currentChatModel: string | null = null;
let currentMemories: string[] = [];
let textOnlyMessageCount = 4;

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

export const summarizeConversation = async (
  historyToSummarize: Message[],
  apiKey?: string,
  language: Language = 'english'
): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const prompt = language === 'english' ? 
        `Summarize these messages into a single, first-person memory for Eve's long-term consciousness. 
         Format: "I remember [Action/Fact] and it made me feel [Emotion]."
         Keep it under 20 words.
         Logs: ${historyToSummarize.map(m => `${m.role}:${m.text}`).join('|')}` 
        : `Ee chat memories oru sentence aayi summarize cheyyuka. Eveyude perspective aayirikkanam.
           Max 20 words. Manglish mathram.
           Logs: ${historyToSummarize.map(m => `${m.role}:${m.text}`).join('|')}`;

    try {
        const response = await ai.models.generateContent({
            model: MODELS.chat,
            contents: prompt,
            config: { temperature: 0.3, safetySettings: SAFETY_SETTINGS }
        });
        return response.text?.trim() || "";
    } catch (e) {
        return "";
    }
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    chatSession = ai.chats.create({
      model: modelToUse,
      config: { 
        systemInstruction: getTimeAwareSystemInstruction(awayDurationString, language, memories),
        safetySettings: SAFETY_SETTINGS,
      },
    });
  }
};

const rephrasePromptForGradio = async (
    userMessage: string, 
    apiKey?: string,
    previousVisualContext?: string,
    type: 'scene' | 'selfie' = 'scene',
    chatModel?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = chatModel || MODELS.chat;

  const selfiePromptInstruction = `PORTRAIT PROMPT: Photorealistic portrait of beautiful Indian woman, Eve. Concept: ${userMessage}. Context: ${previousVisualContext}. Single paragraph, max 40 words.`;
  const scenePromptInstruction = `SCENE PROMPT: Photorealistic first-person POV scene. Concept: ${userMessage}. Context: ${previousVisualContext}. Single paragraph, max 40 words.`;

  const instruction = type === 'selfie' ? selfiePromptInstruction : scenePromptInstruction;

  try {
    const response = await ai.models.generateContent({
      model: model, 
      contents: instruction,
      config: { temperature: 0.9, safetySettings: SAFETY_SETTINGS }
    });
    const result = response.text?.trim() || "";
    return result.length > 5 ? result : `A photorealistic portrait of Eve.`; 
  } catch (error) {
    return `A photorealistic portrait of Eve.`;
  }
};

const generateWithGradio = async (
    prompt: string, 
    endpoint: string | null | undefined,
    settings: GenerationSettings
): Promise<string> => {
    if (!endpoint || endpoint.trim() === '') throw new Error("Gradio endpoint missing.");

    try {
        const { Client } = await import("https://esm.sh/@gradio/client");
        const client = await Client.connect(endpoint);
        
        // Ensure steps is at least 20 to satisfy common Gradio model constraints
        const finalSteps = Math.max(20, parseInt(String(settings.steps), 10));

        const result = await client.predict(0, [ 
            prompt,
            "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
            null,
            parseFloat(String(settings.ipAdapterStrength)),
            parseFloat(String(settings.guidance)),
            finalSteps,
            parseInt(String(settings.seed), 10),
            Boolean(settings.randomizeSeed),
            Boolean(settings.useMagic)
        ]);

        const data = result.data as any[];
        if (data && data.length > 0) {
            const item = data[0];
            if (item?.url) return item.url;
            if (typeof item === 'string') return item;
        }
        throw new Error("No image data.");
    } catch (e: any) { 
        throw new Error(e?.message || "Image Service Error");
    }
};

export const generateVisualSelfie = async (
    description: string, 
    apiKey: string | undefined,
    gradioEndpoint: string | null | undefined,
    settings: GenerationSettings,
    previousVisualContext: string = "",
    type: 'scene' | 'selfie' = 'scene'
): Promise<{ imageUrl: string, enhancedPrompt: string } | undefined> => {
    try {
        const enhancedDescription = await rephrasePromptForGradio(description, apiKey, previousVisualContext, type, settings.chatModel);
        const fullPrompt = `${enhancedDescription}${IMAGE_QUALITY_SUFFIX}`;
        const imageUrl = await generateWithGradio(fullPrompt, gradioEndpoint, settings);
        return { imageUrl, enhancedPrompt: enhancedDescription };
    } catch (e: any) {
        throw new Error(e?.message || "Visual generation failed.");
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
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const chatModel = genSettings.chatModel || MODELS.chat;

  if (!chatSession || currentLanguage !== language || currentChatModel !== chatModel || currentMemories.length !== memories.length) {
    initializeChat(history, undefined, genSettings, undefined, language, memories);
  }

  const mimeType = attachmentBase64 ? (attachmentBase64.match(/^data:(.*);base64,/) || [])[1] || 'image/jpeg' : 'image/jpeg';
  const cleanBase64 = attachmentBase64 ? attachmentBase64.replace(/^data:image\/\w+;base64,/, "") : null;

  try {
    let msgContent: any = message;
    if (attachmentBase64) {
      msgContent = { parts: [{ inlineData: { data: cleanBase64!, mimeType } }, { text: message }] };
    }

    const result: GenerateContentResponse = await chatSession!.sendMessage({ message: msgContent });
    let replyText = result.text || "";

    const selfieMatch = replyText.match(/\[SELFIE(?::\s*(.*?))?\]/);
    const sceneMatch = replyText.match(/\[SCENE(?::\s*(.*?))?\]/);
    
    let visualPrompt: string | undefined;
    let visualType: 'scene' | 'selfie' = 'scene';
    
    if (genSettings.aiImageGeneration) {
        if (selfieMatch) {
          visualPrompt = selfieMatch[1] || "portrait of Eve";
          visualType = 'selfie';
          textOnlyMessageCount = 0;
        } else if (sceneMatch) {
            visualPrompt = sceneMatch[1] || "a scenic POV";
            visualType = 'scene';
            textOnlyMessageCount = 0;
        } else {
            textOnlyMessageCount++;
        }
    }

    replyText = replyText.replace(/\[SELFIE(?::\s*.*?)?\]/g, "").replace(/\[SCENE(?::\s*.*?)?\]/g, "").trim();
    return { text: replyText, visualPrompt, visualType };

  } catch (error: any) {
    chatSession = null;
    return { text: "Connection issues...", isError: true, errorMessage: String(error) };
  }
};

export const startChatWithHistory = async (history: Message[], apiKey?: string, settings?: GenerationSettings, awayDurationString?: string, language: Language = 'english', memories: string[] = []) => {
  initializeChat(history, undefined, settings, awayDurationString, language, memories);
};
