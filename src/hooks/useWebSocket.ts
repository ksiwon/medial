// src/hooks/useWebSocket.ts
//
// Wires the live UI to the FastAPI backend in /server.
// Protocol — exhibition plan §3c:
//
//   Client → Server
//     binary frame                      : opus/webm chunk (MediaRecorder)
//     {type:'start',case_id:string}
//     {type:'end_turn'}
//     {type:'finish'}                   : force-build report before MAX_TURNS
//     {type:'reset'}
//
//   Server → Client
//     {type:'session_started', session_id, session_code}
//     {type:'session_reset'}
//     {type:'stt_result',  text}
//     {type:'llm_response',text, turn, max_turns, model}
//     {type:'tts_audio',   audio (b64 LINEAR16 24 kHz wav)}
//     {type:'avatar_video',video (b64 mp4)}
//     {type:'report_ready',report}
//     {type:'emergency',   level}
//     {type:'error',       message}

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { WsInboundMessage } from '../types';

export interface WsControls {
  startSession: (mode?: 'companion' | 'triage') => void;
  endTurn: () => void;
  finishEarly: () => void;
  reset: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  // MEDial 2.0 — escalation 동의 + 신호 주입 + 모드 전환
  consentTriage: () => void;
  declineTriage: () => void;
  setMode: (mode: 'companion' | 'triage') => void;
  setTtsSpeed: (speed: number) => void;
  sendVital: (vital: object) => void;
  sendMeal: (meal: object) => void;
  sendEvent: (event: object) => void;
}

// ── PCM helpers ──────────────────────────────────────────
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function useWebSocket(): WsControls {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);

  // ── Outgoing helpers ─────────────────────────────────
  const sendJson = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendBinary = useCallback((buffer: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(buffer);
    }
  }, []);

  // ── Audio queue playback ─────────────────────────────
  const playNextAudio = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    const b64 = audioQueueRef.current.shift()!;
    isPlayingRef.current = true;
    try {
      const bytes = b64ToBytes(b64);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        isPlayingRef.current = false;
        const store = useAppStore.getState();
        if (!store.isRecording) store.setLiveDoctorState('idle');
        playNextAudio();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        isPlayingRef.current = false;
        useAppStore.getState().setLiveDoctorState('idle');
      };
      audio.play().catch(() => {
        isPlayingRef.current = false;
        useAppStore.getState().setLiveDoctorState('idle');
      });
    } catch {
      isPlayingRef.current = false;
    }
  }, []);

  // ── Message dispatcher ──────────────────────────────
  const handleMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    let msg: WsInboundMessage;
    try { msg = JSON.parse(event.data); } catch { return; }

    const store = useAppStore.getState();

    switch (msg.type) {
      case 'session_started':
        // server confirms new session — clear local state but keep liveScreen
        store.setCurrentSTT('');
        store.setLiveDoctorState('speaking');
        break;

      case 'session_reset':
        store.resetLiveSession();
        break;

      case 'stt_result':
        if (msg.text) {
          store.setCurrentSTT('');
          store.addLiveMessage({ role: 'user', text: msg.text, timestamp: Date.now() });
          store.setLiveDoctorState('thinking');
        }
        break;

      case 'llm_response':
        if (msg.text) {
          store.addLiveMessage({ role: 'ai', text: msg.text, timestamp: Date.now() });
          // server is authoritative for turn count
          if (typeof msg.turn === 'number') {
            useAppStore.setState({ liveTurnCount: msg.turn });
          } else {
            store.incrementLiveTurn();
          }
          store.setLiveDoctorState('speaking');
        }
        break;

      case 'tts_audio':
        if (msg.audio) {
          audioQueueRef.current.push(msg.audio);
          playNextAudio();
        }
        break;

      case 'avatar_video':
        // Hook point for Wav2Lip mp4 playback — surface via store flag.
        // The CSS avatar in VirtualDoctor remains the default visual.
        if (msg.video) store.setAvatarMode('video');
        break;

      case 'report_ready':
        if (msg.report) {
          store.setLiveReport(msg.report);
          store.commitSession();
          store.setLiveScreen('live-report');
        }
        break;

      case 'emergency':
        store.setLiveScreen('live-emergency');
        store.setLiveDoctorState('emergency');
        store.setEmergencyActive(true);   // companion 모드 오버레이 트리거
        store.logEvent('emergency', '119');
        break;

      case 'mode_switch':
        // companion → triage 전환 (force escalation 또는 동의 수락)
        store.setChatMode(msg.mode ?? 'triage');
        store.setTriageSuggested(false);
        if (msg.mode === 'triage') {
          useAppStore.setState({ escalationReason: msg.reason ?? null });
          store.logEvent('mode_switch', msg.reason ?? 'triage');
        }
        break;

      case 'triage_suggested':
        // 부드러운 상담 제안 — 동의 칩 노출
        store.setTriageSuggested(true, msg.reason ?? null);
        store.logEvent('escalation_suggest', msg.reason ?? '');
        break;

      case 'error':
        // Surface server errors as STT preview so the user sees them
        if (msg.message) {
          store.setCurrentSTT(`⚠ ${msg.message}`);
          store.setLiveDoctorState('idle');
        }
        break;
    }
  }, [playNextAudio]);

  // ── Connect / disconnect on mode + URL changes ──────
  const connect = useCallback(() => {
    const { appMode, wsUrl, setWsConnected } = useAppStore.getState();
    if (appMode !== 'live' && appMode !== 'companion') {
      wsRef.current?.close();
      return;
    }
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN ||
                          wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let ws: WebSocket;
    try { ws = new WebSocket(wsUrl); } catch { setWsConnected(false); return; }
    wsRef.current = ws;

    ws.onopen = () => useAppStore.getState().setWsConnected(true);
    ws.onmessage = handleMessage;
    ws.onerror = () => useAppStore.getState().setWsConnected(false);
    ws.onclose = () => {
      useAppStore.getState().setWsConnected(false);
      // Auto-reconnect while still in a WS-backed mode (3s backoff)
      const m = useAppStore.getState().appMode;
      if (m === 'live' || m === 'companion') {
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(connect, 3000);
      }
    };
  }, [handleMessage]);

  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.appMode !== prev.appMode || state.wsUrl !== prev.wsUrl) {
        wsRef.current?.close();
        wsRef.current = null;
        connect();
      }
    });
    connect();
    return () => {
      unsub();
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── Public controls ─────────────────────────────────
  // mode: 'companion'(일상 말동무) | 'triage'(상담). 서버는 P3에서 분기; 미지원 시 무시됨.
  const startSession = useCallback((mode?: 'companion' | 'triage') => {
    sendJson({ type: 'start', case_id: 'free_input', mode });
  }, [sendJson]);

  const endTurn = useCallback(() => {
    sendJson({ type: 'end_turn' });
  }, [sendJson]);

  const finishEarly = useCallback(() => {
    sendJson({ type: 'finish' });
  }, [sendJson]);

  const reset = useCallback(() => {
    sendJson({ type: 'reset' });
  }, [sendJson]);

  const startRecording = useCallback(async () => {
    if (mediaRecorderRef.current?.state === 'recording') return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      useAppStore.getState().setCurrentSTT('⚠ 마이크 권한이 필요해요');
      return;
    }
    mediaStreamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) e.data.arrayBuffer().then(sendBinary);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
    recorder.start(100);
    mediaRecorderRef.current = recorder;
    useAppStore.getState().setIsRecording(true);
    useAppStore.getState().setLiveDoctorState('listening');
  }, [sendBinary]);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    mediaRecorderRef.current = null;
    useAppStore.getState().setIsRecording(false);
    sendJson({ type: 'end_turn' });
    useAppStore.getState().setLiveDoctorState('thinking');
  }, [sendJson]);

  // ── MEDial 2.0 controls ──────────────────────────────
  const consentTriage = useCallback(() => sendJson({ type: 'consent_triage' }), [sendJson]);
  const declineTriage = useCallback(() => sendJson({ type: 'decline_triage' }), [sendJson]);
  const setMode = useCallback((mode: 'companion' | 'triage') => sendJson({ type: 'set_mode', mode }), [sendJson]);
  const setTtsSpeed = useCallback((speed: number) => sendJson({ type: 'set_tts_speed', speed }), [sendJson]);
  const sendVital = useCallback((vital: object) => sendJson({ type: 'signal_vital', vital }), [sendJson]);
  const sendMeal = useCallback((meal: object) => sendJson({ type: 'signal_meal', meal }), [sendJson]);
  const sendEvent = useCallback((event: object) => sendJson({ type: 'signal_event', event }), [sendJson]);

  // 반환 객체 identity를 안정화한다. 그렇지 않으면 매 렌더마다 새 객체가 되어
  // 이를 의존성으로 쓰는 훅(useVitalsSim 등)에서 무한 리렌더가 발생한다.
  return useMemo(() => ({
    startSession, endTurn, finishEarly, reset, startRecording, stopRecording,
    consentTriage, declineTriage, setMode, setTtsSpeed, sendVital, sendMeal, sendEvent,
  }), [
    startSession, endTurn, finishEarly, reset, startRecording, stopRecording,
    consentTriage, declineTriage, setMode, setTtsSpeed, sendVital, sendMeal, sendEvent,
  ]);
}
