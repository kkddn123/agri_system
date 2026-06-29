import React, { useEffect, useMemo, useState } from "react";
import { loadPublicDatasets, isExample } from "../lib/dataLoader";
import { theme, card, badge } from "../theme";

const CATEGORY_LABELS = {
  A: "판매경로", B: "생산·유통관리", C: "소비자행동", D: "정보·교육", E: "식품부",
};

const FOLDER_ORDER = ["출하 가이드 · 거래전략", "수급관리", "소비정보", "소득·수익성"];

export default function PublicDataCatalog() {
  const [items, setItems] = useState(null); // null = 로딩중
  const [meta, setMeta] = useState({});
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState("전체");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [taggedOnly, setTaggedOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPublicDatasets()
      .then(({ items, meta }) => { if (alive) { setItems(items); setMeta(meta); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const allFormats = useMemo(() => {
    const set = new Set();
    (items || []).forEach((d) => (d.format || []).forEach((f) => set.add(f)));
    return ["전체", ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    return (items || []).filter((d) => {
      if (verifiedOnly && !d.verified) return false;
      if (taggedOnly && !(d.tags && d.tags.length)) return false;
      if (formatFilter !== "전체" && !(d.format || []).includes(formatFilter)) return false;
      if (query) {
        const hay = `${d.title} ${d.agency} ${d.description || ""}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      return true;
    });
  }, [items, query, formatFilter, verifiedOnly, taggedOnly]);

  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach((d) => {
      const cat = d.category || "?";
      if (!g[cat]) g[cat] = { __folders: {}, __noFolder: [] };
      const folder = d.folder || null;
      if (folder) {
        (g[cat].__folders[folder] = g[cat].__folders[folder] || []).push(d);
      } else {
        g[cat].__noFolder.push(d);
      }
    });
    return g;
  }, [filtered]);

  const stats = useMemo(() => {
    const total = (items || []).length;
    const verified = (items || []).filter((d) => d.verified).length;
    const exampleCount = (items || []).filter(isExample).length;
    return { total, verified, unverified: total - verified, exampleCount };
  }, [items]);

  if (error) {
    return <div style={{ color: theme.danger, padding: 24 }}>데이터를 불러오지 못했습니다: {error}</div>;
  }
  if (items === null) {
    return <div style={{ color: theme.textMuted, padding: 24 }}>불러오는 중...</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ color: theme.text, fontSize: 18, margin: 0 }}>농촌진흥청 공공데이터 카탈로그</h2>
        <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 6 }}>
          public/data/public-datasets.json에 항목을 추가하면 이 화면에 자동으로 반영됩니다.
        </p>
      </div>

      {stats.total > 0 && stats.exampleCount === stats.total && (
        <div style={{ ...card, borderColor: theme.warn, marginBottom: 16, fontSize: 13, color: theme.warn }}>
          아직 예시 데이터만 들어 있습니다. public/data/public-datasets.json에 실제 카탈로그를 채워주세요.
        </div>
      )}

      <div style={{ ...card, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·기관·설명에서 검색…"
          style={{
            flex: 1, minWidth: 200, background: theme.panelAlt, border: `1px solid ${theme.panelBorder}`,
            borderRadius: 8, padding: "8px 12px", color: theme.text, fontSize: 13, boxSizing: "border-box",
          }}
        />
        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value)}
          style={{ background: theme.panelAlt, border: `1px solid ${theme.panelBorder}`, borderRadius: 8, padding: "8px 12px", color: theme.text, fontSize: 13 }}
        >
          {allFormats.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: theme.textMuted, fontSize: 13 }}>
          <input type="checkbox" checked={taggedOnly} onChange={(e) => setTaggedOnly(e.target.checked)} /> 태그 매칭만
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: theme.textMuted, fontSize: 13 }}>
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> verified만
        </label>
        <div style={{ color: theme.textFaint, fontSize: 12 }}>필터: {filtered.length} / 전체 {stats.total}건</div>
      </div>

      <div style={{ ...card, display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20, fontSize: 12, color: theme.textMuted }}>
        <span>전체 <b style={{ color: theme.text }}>{stats.total}</b>건</span>
        <span>✅ verified <b style={{ color: theme.accent }}>{stats.verified}</b>건</span>
        <span>❓ 미확인 <b style={{ color: theme.warn }}>{stats.unverified}</b>건</span>
        {meta.last_synced && <span>마지막 동기화 {meta.last_synced}</span>}
      </div>

      {Object.keys(grouped).length === 0 && (
        <div style={{ color: theme.textFaint, padding: 24, textAlign: "center" }}>조건에 맞는 데이터셋이 없습니다.</div>
      )}

      {Object.entries(grouped).map(([cat, { __folders, __noFolder }]) => {
        const totalCount = Object.values(__folders).flat().length + __noFolder.length;
        const folderKeys = FOLDER_ORDER.filter((f) => __folders[f])
          .concat(Object.keys(__folders).filter((f) => !FOLDER_ORDER.includes(f)));
        return (
          <div key={cat} style={{ marginBottom: 28 }}>
            <h3 style={{ color: theme.text, fontSize: 14, marginBottom: 12 }}>
              <span style={{ color: theme.accent }}>{cat}.</span> {CATEGORY_LABELS[cat] || cat} ({totalCount}건)
            </h3>
            {folderKeys.map((folder) => (
              <FolderGroup key={folder} name={folder} items={__folders[folder]} />
            ))}
            {__noFolder.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: folderKeys.length > 0 ? 12 : 0 }}>
                {__noFolder.map((d) => <DatasetCard key={d.id} d={d} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FolderGroup({ name, items }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 14, border: `1px solid ${theme.panelBorder}`, borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          background: theme.panelAlt, border: "none", padding: "10px 14px",
          cursor: "pointer", color: theme.text, fontSize: 13, fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 14 }}>{open ? "📂" : "📁"}</span>
        <span style={{ flex: 1, textAlign: "left" }}>{name}</span>
        <span style={{ color: theme.textMuted, fontSize: 12, fontWeight: 400 }}>{items.length}건</span>
        <span style={{ color: theme.textMuted, fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {items.map((d) => <DatasetCard key={d.id} d={d} />)}
        </div>
      )}
    </div>
  );
}

function DatasetCard({ d }) {
  return (
    <div style={{ ...card, padding: 16, position: "relative" }}>
      {d._example && (
        <span style={{ ...badge(theme.warn), position: "absolute", top: 12, right: 12 }}>예시</span>
      )}
      <div style={{ color: theme.text, fontWeight: 700, fontSize: 14, marginBottom: 6, paddingRight: d._example ? 50 : 0 }}>
        {d.title}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {(d.format || []).map((f) => <span key={f} style={badge(theme.info)}>{f}</span>)}
        {(d.tags || []).map((t) => <span key={t} style={badge("#b083f0")}>{t}</span>)}
        {d.verified ? (
          <span style={badge(theme.accent)}>✓ verified{d.verified_date ? ` (${d.verified_date})` : ""}</span>
        ) : (
          <span style={badge(theme.warn)}>? 미확인</span>
        )}
      </div>
      <div style={{ color: theme.textMuted, fontSize: 12, marginBottom: 6 }}>
        {d.agency} · 갱신 {d.update_frequency || "미확인"} · 활용 {d.usage_count ?? "?"}
      </div>
      {d.description && (
        <div style={{ color: theme.textMuted, fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>{d.description}</div>
      )}
      {d.url ? (
        <a href={d.url} target="_blank" rel="noreferrer" style={{ color: theme.accent, fontSize: 12.5, fontWeight: 600 }}>
          링크 열기 →
        </a>
      ) : d.local_file ? (
        <a href={`/data/guides/${encodeURIComponent(d.local_file)}`} target="_blank" rel="noreferrer" style={{ color: theme.accent, fontSize: 12.5, fontWeight: 600 }}>
          📄 원문 열기 →
        </a>
      ) : d.source_url ? (
        <a href={d.source_url} target="_blank" rel="noreferrer" style={{ color: theme.accent, fontSize: 12.5, fontWeight: 600 }}>
          🏛 도서관에서 열기 →
        </a>
      ) : (
        <span style={{ color: theme.textFaint, fontSize: 12.5 }}>링크 미입력</span>
      )}
    </div>
  );
}
