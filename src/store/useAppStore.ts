// src/store/useAppStore.ts
import { create } from 'zustand';
import { ScreenId, ActionMode, DoctorState } from '../types';
import { cases } from '../data/mockData';

interface AppState {
  currentCaseId: string;
  currentScreen: ScreenId;
  prevConvIndex: number | null;
  dialogueIndex: number;
  actionMode: ActionMode;
  doctorState: DoctorState;
  showFaceAnalysis: boolean;
  showEmpathy: boolean;
  showAiRecommendation: boolean;
  fontScale: number;
  region: 'rural' | 'urban';

  setCurrentCase: (caseId: string) => void;
  setCurrentScreen: (screen: ScreenId) => void;
  setPrevConvIndex: (index: number | null) => void;
  setDialogueIndex: (index: number) => void;
  incrementDialogueIndex: () => void;
  resetDialogue: () => void;
  startFromConversation: (index: number) => void;
  setActionMode: (mode: ActionMode) => void;
  setDoctorState: (state: DoctorState) => void;
  toggleFaceAnalysis: () => void;
  toggleEmpathy: () => void;
  toggleAiRecommendation: () => void;
  setFontScale: (scale: number) => void;
  setRegion: (region: 'rural' | 'urban') => void;
  onHome: () => void;
  onTriageSend: (action: 'emergency' | 'healthCenter' | 'selfCare' | 'dialogue') => void;

  getCurrentCase: () => typeof cases[0];
}

export const useAppStore = create<AppState>((set, get) => ({
  currentCaseId: 'case1',
  currentScreen: 'home',
  prevConvIndex: null,
  dialogueIndex: 0,
  actionMode: 'chips',
  doctorState: 'idle',
  showFaceAnalysis: true,
  showEmpathy: true,
  showAiRecommendation: true,
  fontScale: 1.0,
  region: 'rural',

  setCurrentCase: (caseId) => {
    set({ currentCaseId: caseId, currentScreen: 'home', prevConvIndex: null, dialogueIndex: 0, actionMode: 'chips', doctorState: 'idle' });
  },
  setCurrentScreen: (screen) => set({ currentScreen: screen }),
  setPrevConvIndex: (index) => set({ prevConvIndex: index }),
  setDialogueIndex: (index) => set({ dialogueIndex: index }),
  incrementDialogueIndex: () => set((s) => ({ dialogueIndex: s.dialogueIndex + 1 })),
  resetDialogue: () => set({ dialogueIndex: 0, prevConvIndex: null, actionMode: 'chips', doctorState: 'idle' }),

  startFromConversation: (index) => {
    set({ prevConvIndex: index, dialogueIndex: 0, currentScreen: 'chat', actionMode: 'chips', doctorState: 'speaking' });
  },

  setActionMode: (mode) => set({ actionMode: mode }),
  setDoctorState: (state) => set({ doctorState: state }),

  toggleFaceAnalysis: () => set((s) => ({ showFaceAnalysis: !s.showFaceAnalysis })),
  toggleEmpathy: () => set((s) => ({ showEmpathy: !s.showEmpathy })),
  toggleAiRecommendation: () => set((s) => ({ showAiRecommendation: !s.showAiRecommendation })),
  setFontScale: (scale) => set({ fontScale: scale }),
  setRegion: (region) => set({ region }),

  onHome: () => {
    set({ currentScreen: 'home', dialogueIndex: 0, prevConvIndex: null, actionMode: 'chips', doctorState: 'idle' });
  },

  onTriageSend: (action) => {
    if (action === 'dialogue') {
      set({ currentScreen: 'chat', dialogueIndex: 0, prevConvIndex: null, actionMode: 'chips', doctorState: 'speaking' });
    } else {
      set({ currentScreen: action });
    }
  },

  getCurrentCase: () => {
    const { currentCaseId } = get();
    return cases.find((c) => c.id === currentCaseId) ?? cases[0];
  },
}));
