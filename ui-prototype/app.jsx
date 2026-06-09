// app.jsx — main shell

const { useState: useStateApp, useEffect: useEffectApp } = React;

function App() {
  const [step, setStep] = useStateApp("source");
  const [toolView, setToolView] = useStateApp(null); // "library" | "history" | null

  // Tag screens with labels for comment context
  const screenLabel = toolView
    ? ({ library: "LIB 结构样例库", history: "HIS 历史版本" }[toolView])
    : ({ source: "01 样例解析", materials: "02 素材输入", diagnose: "03 缺口诊断", compile: "04 成片编译" }[step]);

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
        />
        <div className="main" data-screen-label={screenLabel}>
          {toolView === "library" && (
            <ScreenLibrary onBack={() => setToolView(null)} />
          )}
          {toolView === "history" && (
            <ScreenHistory onReEdit={() => { setToolView(null); setStep("source"); }} />
          )}
          {!toolView && step === "source"    && <ScreenSource    onNext={() => setStep("materials")} />}
          {!toolView && step === "materials" && <ScreenMaterials onNext={() => setStep("diagnose")}  onBack={() => setStep("source")} />}
          {!toolView && step === "diagnose"  && <ScreenDiagnose  onNext={() => setStep("compile")}   onBack={() => setStep("materials")} />}
          {!toolView && step === "compile"   && <ScreenCompile   onBack={() => setStep("diagnose")} />}
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
