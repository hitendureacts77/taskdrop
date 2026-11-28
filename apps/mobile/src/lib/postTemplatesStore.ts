import AsyncStorage from '@react-native-async-storage/async-storage';
import * as T from './postTemplates';

/** The post templates (lib/postTemplates.ts) kept in this device's storage. */
export type { PostTemplate } from './postTemplates';

export const listTemplates = (userId: string) => T.listTemplates(AsyncStorage, userId);
export const saveTemplate = (userId: string, input: Parameters<typeof T.saveTemplate>[2]) => T.saveTemplate(AsyncStorage, userId, input);
export const removeTemplate = (userId: string, id: string) => T.removeTemplate(AsyncStorage, userId, id);
export const clearTemplates = (userId: string) => T.clearTemplates(AsyncStorage, userId);
