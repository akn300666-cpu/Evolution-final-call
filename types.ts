
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  image?: string; // Base64 string for images displayed in chat
  isError?: boolean;
  isImageLoading?: boolean;
}

export type Language = 'english' | 'manglish';

export interface EveConfig {
  voiceEnabled: boolean;
  personality: 'default' | 'bananafy';
}

export interface ApiKeyDef {
  id: string;
  label: string;
  key: string;
}

export interface GenerationSettings {
  // Image Gen Settings
  guidance: number;
  steps: number;
  ipAdapterStrength: number;
  loraStrength: number;
  seed: number;
  randomizeSeed: boolean;
  useMagic: boolean;
  aiImageGeneration: boolean;
  // Chat Model Settings
  chatModel: string;
  temperature: number;
  topP: number;
  topK: number;
  historyDepth: number; // Controls the token/context window
}

export interface StoredSession {
  messages: Message[];
  memories: string[]; // NEW: Persistent consolidated memories
  lastUpdated: number;
}
