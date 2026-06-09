// screen-history.jsx — 历史版本 (previously generated materials)

const ScreenHistory = ({ onReEdit }) => {
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  };

  const filtered = HISTORY_RECORDS.filter(r => {
    if (filterStatus === "all") return true;
    return r.status === filterStatus;
  });

  const SVG_BY_ROLE = {
    hook: SvgHookShape, pain: SvgPainShape, emotion: SvgEmotionShape,
    product: SvgProductShape, compare: SvgCompareShape, social: SvgSocialShape, cta: SvgCtaShape,
  };

  const statusMeta = {
    done: { label: "已完成", color: "var(--st-filled)", bg: "var(--st-filled-bg)", line: "var(--st-filled-line)" },
    draft: { label: "草稿", color: "var(--st-weakly)", bg: "var(--st-weakly-bg)", line: "var(--st-weakly-line)" },
    rendering: { label: "渲染中", color: "var(--accent)", bg: "var(--accent-dim)", line: "var(--accent-line)" },
  };

  // Detail view
  if (selectedRecord) {
    const r = selectedRecord;
    const sm = statusMeta[r.status] || statusMeta.done;
    const totalDur = parseFloat(r.duration);
    const segCount = r.segments.length;
    const segDur = totalDur / segCount;

    return (
      <div className="screen">
        <div className="screen-head">
          <div className="screen-head-l">
            <button className="btn" style={{ padding: "6px 10px", flexShrink: 0 }}
              onClick={() => setSelectedRecord(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
              返回列表
            </button>
            <div>
              <h1 style={{ fontSize: 20 }}>{r.title}</h1>
              <div className="screen-head-sub">{r.product} · {r.version}</div>
            </div>
          </div>
          <div className="screen-head-r">
            <span className="pill" style={{ color: sm.color, borderColor: sm.line, background: sm.bg }}>
              <span className="dot" style={{ background: sm.color }} />
              {sm.label}
            </span>
          </div>
        </div>

        {/* Preview + Meta side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, marginBottom: 16 }}>
          {/* Preview panel */}
          <div className="panel" style={{ display: "flex", flexDirection: "column" }}>
            <div className="panel-head">
              <h4>成片预览</h4>
              <span className="eyebrow">{r.version}</span>
            </div>
            <div className="panel-body" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{
                flex: 1, aspectRatio: "9/16", maxHeight: 340,
                background: `linear-gradient(135deg, ${r.color}22, ${r.color}08)`,
                border: "1px solid var(--border)", borderRadius: 6,
                position: "relative", overflow: "hidden",
                display: "grid", placeItems: "center",
              }}>
                <div style={{ position: "absolute", inset: 0, opacity: 0.3 }}>
                  {React.createElement(SVG_BY_ROLE[r.segments[0]] || SvgHookShape)}
                </div>
                <div style={{
                  width: 52, height: 52, borderRadius: "50%",
                  border: `1.5px solid ${r.color}`,
                  display: "grid", placeItems: "center", color: r.color,
                  position: "relative", zIndex: 1,
                }}><Icon name="play" size={20} /></div>
                <div style={{
                  position: "absolute", bottom: 10, left: 10, right: 10,
                  fontSize: 12, color: "#fff", fontWeight: 500,
                  textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                }}>{r.title}</div>
                <span className="mono" style={{
                  position: "absolute", top: 8, right: 8,
                  fontSize: 9, padding: "1px 6px", borderRadius: 3,
                  background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.85)",
                }}>{r.duration}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn" style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => showToast("开始下载 MP4…")}>
                  <Icon name="upload" size={12} /> 下载 MP4
                </button>
                <button className="btn ghost" style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => showToast("已复制分享链接")}>
                  分享
                </button>
              </div>
            </div>
          </div>

          {/* Right: details */}
          <div className="col">
            {/* Info panel */}
            <div className="panel">
              <div className="panel-head">
                <h4>生成信息</h4>
                <span className="eyebrow">记录详情</span>
              </div>
              <div className="panel-body">
                <dl className="kv" style={{ gridTemplateColumns: "90px 1fr" }}>
                  <dt>成品标题</dt><dd><b>{r.title}</b></dd>
                  <dt>目标商品</dt><dd>{r.product}</dd>
                  <dt>源结构</dt><dd>{r.source_title} · <span style={{ color: r.color }}>{r.source_family}</span></dd>
                  <dt>版本</dt><dd className="mono">{r.version}</dd>
                  <dt>时长</dt><dd><b>{r.duration}</b> · {segCount} 段落</dd>
                  <dt>生成时间</dt><dd className="mono">{r.created}</dd>
                  <dt>状态</dt>
                  <dd>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 11, padding: "2px 8px", borderRadius: 4,
                      background: sm.bg, border: `1px solid ${sm.line}`, color: sm.color,
                      fontFamily: "var(--ff-mono)",
                    }}>
                      <span className="dot" style={{ background: sm.color }} />
                      {sm.label}
                    </span>
                  </dd>
                </dl>
              </div>
            </div>

            {/* Stats */}
            <div className="panel">
              <div className="panel-head">
                <h4>预测效果</h4>
                <span className="eyebrow">AI 预测</span>
              </div>
              <div className="panel-body">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  <div className="stat">
                    <div className="stat-label">CTR</div>
                    <div className="stat-value" style={{ color: r.color }}>{r.stats.ctr}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">完播率</div>
                    <div className="stat-value" style={{ color: r.color }}>{r.stats.finish}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">转化率</div>
                    <div className="stat-value" style={{ color: r.color }}>{r.stats.convert}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Structure band */}
            <div className="panel">
              <div className="panel-head">
                <h4>结构序列</h4>
                <span className="eyebrow">{segCount} 段 · {r.source_family}</span>
              </div>
              <div className="panel-body">
                <div className="sband" style={{ height: 38 }}>
                  {r.segments.map((role, i) => {
                    const w = 100 / segCount;
                    return (
                      <div key={i} className={`sband-seg role-${role}`} style={{ width: `${w}%` }}>
                        {w > 8 && <span className="sband-seg-label">{ROLES[role]?.name}</span>}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
                  {[...new Set(r.segments)].map(role => (
                    <div key={role} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span className={`role-dot role-${role}`} />
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{ROLES[role]?.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <ScreenFooter
          status={`${r.version} · ${r.created}`}
          statusTone={r.status === "done" ? "ok" : "warn"}
          secondary={[
            { label: "返回列表", onClick: () => setSelectedRecord(null) },
            { label: "复制为新项目", onClick: () => showToast("已复制为新项目") },
          ]}
          primary={{ label: "重新编辑", onClick: () => { if (onReEdit) onReEdit(); showToast("已载入项目 · 进入编辑模式"); } }}
        />
        <Toast message={toastMsg} visible={toastVisible} />
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="screen">
      <div className="screen-head">
        <div className="screen-head-l">
          <div className="screen-head-num">HIS</div>
          <div>
            <h1>历史版本</h1>
            <div className="screen-head-sub">
              以往生成的所有成片素材 · 点击可查看详情并重新编辑
            </div>
          </div>
        </div>
        <div className="screen-head-r">
          <span className="mono">{HISTORY_RECORDS.length} 条记录</span>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", marginBottom: 16,
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
      }}>
        <span className="eyebrow" style={{ marginRight: 4 }}>状态</span>
        {[
          { id: "all", label: "全部" },
          { id: "done", label: "已完成" },
          { id: "draft", label: "草稿" },
        ].map(f => (
          <button key={f.id} className="btn" onClick={() => setFilterStatus(f.id)}
            style={{
              padding: "4px 10px", fontSize: 11,
              background: filterStatus === f.id ? "var(--accent-dim)" : "transparent",
              borderColor: filterStatus === f.id ? "var(--accent-line)" : "var(--border-2)",
              color: filterStatus === f.id ? "var(--accent)" : "var(--text-dim)",
            }}>{f.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span className="mono dim" style={{ fontSize: 10.5 }}>
          按时间倒序 · 最近 30 天
        </span>
      </div>

      {/* History grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 14,
      }}>
        {filtered.map(r => {
          const sm = statusMeta[r.status] || statusMeta.done;
          const segCount = r.segments.length;
          return (
            <div key={r.id}
              onClick={() => setSelectedRecord(r)}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8, overflow: "hidden",
                cursor: "pointer", transition: "all 150ms",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = r.color + "88"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.3)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
            >
              {/* Thumbnail */}
              <div style={{
                aspectRatio: "16/9", position: "relative", overflow: "hidden",
                background: `linear-gradient(135deg, ${r.color}22, ${r.color}08)`,
              }}>
                <div style={{ position: "absolute", inset: 0, opacity: 0.3 }}>
                  {React.createElement(SVG_BY_ROLE[r.segments[0]] || SvgHookShape)}
                </div>
                {/* Structure band overlay */}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 18, display: "flex" }}>
                  {r.segments.map((role, i) => (
                    <div key={i} className={`role-${role}`}
                      style={{ width: `${100/segCount}%`, opacity: 0.8, borderRight: "1px solid rgba(0,0,0,0.3)" }} />
                  ))}
                </div>
                {/* Play */}
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%",
                    background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
                    border: `1.5px solid ${r.color}`,
                    display: "grid", placeItems: "center", color: r.color,
                  }}><Icon name="play" size={14} /></div>
                </div>
                {/* Status badge */}
                <div style={{ position: "absolute", top: 8, left: 8 }}>
                  <span style={{
                    fontSize: 9, padding: "2px 7px", borderRadius: 3,
                    background: sm.bg, border: `1px solid ${sm.line}`, color: sm.color,
                    fontFamily: "var(--ff-mono)", fontWeight: 600,
                  }}>{sm.label}</span>
                </div>
                <span className="mono" style={{
                  position: "absolute", top: 8, right: 8,
                  fontSize: 9, padding: "1px 6px", borderRadius: 3,
                  background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.85)",
                }}>{r.duration}</span>
              </div>

              {/* Info */}
              <div style={{ padding: "12px 14px" }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 4,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{r.title}</div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--text-mute)", marginBottom: 8 }}>
                  {r.product}
                </div>

                {/* Source info */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span className="tag" style={{
                    fontSize: 10, padding: "1px 6px",
                    color: r.color, borderColor: r.color + "44",
                  }}>{r.source_family}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>{r.version}</span>
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                  <div>
                    <span className="mono" style={{ color: "var(--text-mute)", fontSize: 9.5 }}>CTR</span>
                    <div style={{ fontWeight: 600, color: r.color, marginTop: 1 }}>{r.stats.ctr}</div>
                  </div>
                  <div>
                    <span className="mono" style={{ color: "var(--text-mute)", fontSize: 9.5 }}>完播</span>
                    <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 1 }}>{r.stats.finish}</div>
                  </div>
                  <div>
                    <span className="mono" style={{ color: "var(--text-mute)", fontSize: 9.5 }}>转化</span>
                    <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 1 }}>{r.stats.convert}</div>
                  </div>
                </div>

                {/* Time */}
                <div className="mono" style={{
                  fontSize: 10, color: "var(--text-faint)", marginTop: 8,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" style={{ opacity: 0.5 }}>
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 7v5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  {r.created}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{
          padding: "60px 20px", textAlign: "center",
          color: "var(--text-mute)", fontSize: 13,
        }}>
          <Icon name="layers" size={32} />
          <div style={{ marginTop: 12 }}>暂无匹配的历史记录</div>
        </div>
      )}

      <Toast message={toastMsg} visible={toastVisible} />
    </div>
  );
};

Object.assign(window, { ScreenHistory });
