// 대시보드 전체가 공유하는 다크 테마 색상 토큰.
// 기존 v8 시스템(연두색 라이트 테마)과는 별도로, 받으신 목업과 맞춘 다크 네이비 톤입니다.
export const theme = {
  bg: "#0a0e1a",
  panel: "#11162a",
  panelAlt: "#0d1226",
  panelBorder: "#1f2740",
  text: "#e8ecf5",
  textMuted: "#8b93ab",
  textFaint: "#5b6480",
  accent: "#3ecf6e",      // verified / 주력 / 긍정
  accentDim: "#1f5c39",
  info: "#5b8def",        // OpenAPI 등 형식 태그
  warn: "#f0a93a",        // 미확인
  danger: "#ef5350",      // 404 / 오류
  tagBg: "#161d38",
  divider: "#1b2238",
};

export const card = {
  background: theme.panel,
  border: `1px solid ${theme.panelBorder}`,
  borderRadius: 12,
  padding: 20,
};

export const badge = (color) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  background: `${color}22`,
  color,
  border: `1px solid ${color}55`,
});
