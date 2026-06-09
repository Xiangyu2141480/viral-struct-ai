'use client';

// App.tsx — main shell
// (Ported from app.jsx; ReactDOM.createRoot removed — mounted by Next.js page.)

import { useState } from 'react';
import { Sidebar, Spine } from './components';
import { ConnectionBadge, StatusBanner } from './ConnectionStatus';
import { ScreenMaterials, ScreenSource } from './screens-ab';
import { ScreenCompile, ScreenDiagnose } from './screens-cd';
import { ScreenLibrary } from './screen-library';
import { ScreenHistory } from './screen-history';
import { ScreenLab } from './screen-lab';

export default function App() {
  const [step, setStep] = useState('source');
  const [toolView, setToolView] = useState<string | null>(null); // "library" | "history" | null

  // Tag screens with labels for comment context
  const toolLabels: Record<string, string> = { library: 'LIB 结构样例库', history: 'HIS 历史版本', lab: 'LAB 结构实验室' };
  const stepLabels: Record<string, string> = { source: '01 样例解析', materials: '02 素材输入', diagnose: '03 缺口诊断', compile: '04 成片编译' };
  const screenLabel = toolView ? toolLabels[toolView] : stepLabels[step];

  return (
    <div className="app">
      <Sidebar
        activeStep={step}
        setStep={(s) => { setStep(s); setToolView(null); }}
        toolView={toolView}
        setToolView={setToolView}
      />
      <div className="main-col">
        <Spine
          activeStep={step}
          setStep={(s) => { setStep(s); setToolView(null); }}
          projectId="JADE-MOM-2026"
          statusSlot={<ConnectionBadge />}
        />
        <StatusBanner />
        <div className="main" data-screen-label={screenLabel}>
          {toolView === 'library' && (
            <ScreenLibrary onBack={() => setToolView(null)} />
          )}
          {toolView === 'history' && (
            <ScreenHistory onReEdit={() => { setToolView(null); setStep('source'); }} />
          )}
          {toolView === 'lab' && (
            <ScreenLab />
          )}
          {!toolView && step === 'source'    && <ScreenSource    onNext={() => setStep('materials')} />}
          {!toolView && step === 'materials' && <ScreenMaterials onNext={() => setStep('diagnose')}  onBack={() => setStep('source')} />}
          {!toolView && step === 'diagnose'  && <ScreenDiagnose  onNext={() => setStep('compile')}   onBack={() => setStep('materials')} />}
          {!toolView && step === 'compile'   && <ScreenCompile   onBack={() => setStep('diagnose')} />}
        </div>
      </div>
    </div>
  );
}
