import { Message, ApiKeyDef, GenerationSettings, Language, StoredSession } from '../types';

const DB_NAME = 'EveVaultDB';
const DB_VERSION = 2; // Incremented for schema change
const STORE_NAME = 'sessions';
const GLOBAL_SESSION_KEY = 'global_session';

const KEYS_STORAGE_KEY = 'eve_api_keys';
const ACTIVE_KEY_ID_STORAGE_KEY = 'eve_active_key_id';
const GRADIO_URL_STORAGE_KEY = 'eve_gradio_url';
const GEN_SETTINGS_STORAGE_KEY = 'eve_gen_settings';
const LANGUAGE_STORAGE_KEY = 'eve_language';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event: Event) => {
      const req = event.target as IDBRequest;
      reject(req.error);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveSession = async (messages: Message[], memories: string[] = []) => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    const data = { id: GLOBAL_SESSION_KEY, messages, memories, lastUpdated: Date.now() };
    return new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction([STORE_NAME], 'readwrite');
      transaction.oncomplete = () => { if (db) db.close(); resolve(); };
      transaction.onerror = (event: Event) => {
        const tx = event.target as IDBTransaction;
        if (db) db.close();
        reject(tx.error);
      };
      const store = transaction.objectStore(STORE_NAME);
      store.put(data);
    });
  } catch (e) {
    if (db) db.close();
    throw e;
  }
};

export const loadSession = async (): Promise<StoredSession | null> => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db!.transaction([STORE_NAME], 'readonly');
      transaction.oncomplete = () => { if (db) db.close(); };
      transaction.onerror = (event: Event) => {
        const tx = event.target as IDBTransaction;
        if (db) db.close();
        reject(tx.error);
      };
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(GLOBAL_SESSION_KEY);
      request.onsuccess = () => {
        const res = request.result;
        if (res) {
          resolve({
            messages: res.messages || [],
            memories: res.memories || [],
            lastUpdated: res.lastUpdated || Date.now()
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = (event: Event) => resolve(null);
    });
  } catch (e) {
    if (db) db.close();
    return null;
  }
};

export const clearSession = async () => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    transaction.oncomplete = () => { if (db) db.close(); };
    transaction.onerror = (event: Event) => { if (db) db.close(); };
    const store = transaction.objectStore(STORE_NAME);
    store.delete(GLOBAL_SESSION_KEY);
  } catch (e) {
    if (db) db.close();
    throw e;
  }
};

export const saveLanguage = (language: Language) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
};

export const loadLanguage = (): Language => {
    const lang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return (lang === 'english' || lang === 'manglish') ? lang : 'english';
};

export const saveApiKeys = (keys: ApiKeyDef[]) => {
  localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
};

export const loadApiKeys = (): ApiKeyDef[] => {
  const raw = localStorage.getItem(KEYS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
};

export const saveActiveKeyId = (id: string | null) => {
  if (id) localStorage.setItem(ACTIVE_KEY_ID_STORAGE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY_ID_STORAGE_KEY);
};

export const loadActiveKeyId = (): string | null => localStorage.getItem(ACTIVE_KEY_ID_STORAGE_KEY);

export const saveGradioEndpoint = (url: string) => {
  localStorage.setItem(GRADIO_URL_STORAGE_KEY, url.trim()); 
};

export const loadGradioEndpoint = (): string | null => {
  const url = localStorage.getItem(GRADIO_URL_STORAGE_KEY);
  return url === '' ? null : url;
};

export const GenerationSettingsDefaults: GenerationSettings = {
    guidance: 7.0,
    steps: 30, // Default to 30
    ipAdapterStrength: 0.6,
    loraStrength: 0.45,
    seed: 42,
    randomizeSeed: true,
    useMagic: true,
    aiImageGeneration: true,
    chatModel: 'gemini-3-flash-preview',
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    historyDepth: 20
};

export const saveGenerationSettings = (settings: GenerationSettings) => {
    // Enforcement: ensure steps is never saved below 20
    const finalSettings = {
        ...settings,
        steps: Math.max(20, settings.steps)
    };
    localStorage.setItem(GEN_SETTINGS_STORAGE_KEY, JSON.stringify(finalSettings));
};

export const loadGenerationSettings = (): GenerationSettings => {
    const raw = localStorage.getItem(GEN_SETTINGS_STORAGE_KEY);
    if (raw) {
        const parsed = JSON.parse(raw);
        return { 
            ...GenerationSettingsDefaults, 
            ...parsed,
            steps: Math.max(20, parsed.steps || 20)
        };
    }
    return GenerationSettingsDefaults;
};
