// src/store/useAppStore.ts
import { create } from 'zustand';
import { ScreenId } from '../types';
import { cases } from '../data/mockData';

interface AppState {
  currentCaseId: string;
  currentScreen: ScreenId;
  prevConvIndex: number | null;
  dialogueIndex: number;
  showFaceAnalysis: boolean;
  showEmpathy: boolean;
  showAiRecommendation: boolean;
  region: 'rural' | 'urban';

  setCurrentCase: (caseId: string) => void;
  setCurrentScreen: (screen: ScreenId) => void;
  setPrevConvIndex: (index: number | null) => void;
  setDialogueIndex: (index: number) => void;
  incrementDialogueIndex: () => void;
  resetDialogue: () => void;
  startFromConversation: (index: number) => void;
  toggleFaceAnalysis: () => void;
  toggleEmpathy: () => void;
  toggleAiRecommendation: () => void;
  setRegion: (region: 'rural' | 'urban') => void;

  getCurrentCase: () => typeof cases[0];
}

export const useAppStore = create<AppState>((set, get) => ({
  currentCaseId: 'case1',
  currentScreen: 'home',
  prevConvIndex: null,
  dialogueIndex: 0,
  showFaceAnalysis: true,
  showEmpathy: true,
  showAiRecommendation: true,
  region: 'rural',

  setCurrentCase: (caseId) => {
    set({ currentCaseId: caseId, currentScreen: 'home', prevConvIndex: null, dialogueIndex: 0 });
  },
  setCurrentScreen: (screen) => set({ currentScreen: screen }),
  setPrevConvIndex: (index) => set({ prevConvIndex: index }),
  setDialogueIndex: (index) => set({ dialogueIndex: index }),
  incrementDialogueIndex: () => set((s) => ({ dialogueIndex: s.dialogueIndex + 1 })),
  resetDialogue: () => set({ dialogueIndex: 0, prevConvIndex: null }),

  startFromConversation: (index) => {
    set({ prevConvIndex: index, dialogueIndex: 0, currentScreen: 'chat' });
  },

  toggleFaceAnalysis: () => set((s) => ({ showFaceAnalysis: !s.showFaceAnalysis })),
  toggleEmpathy: () => set((s) => ({ showEmpathy: !s.showEmpathy })),
  toggleAiRecommendation: () => set((s) => ({ showAiRecommendation: !s.showAiRecommendation })),
  setRegion: (region) => set({ region }),

  getCurrentCase: () => {
    const { currentCaseId } = get();
    return cases.find((c) => c.id === currentCaseId) ?? cases[0];
  },
}));
