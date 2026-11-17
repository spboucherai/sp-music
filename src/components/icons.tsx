import type { SVGProps } from "react";

/** Original line icons (24 px grid), drawn for Music SP. */
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 22, ...p }: P) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });
const solid = ({ size = 22, ...p }: P) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true, ...p });

export const IPlay = (p: P) => <svg {...solid(p)}><path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12.4-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6Z" /></svg>;
export const IPause = (p: P) => <svg {...solid(p)}><rect x="5.5" y="4" width="4.6" height="16" rx="1.3" /><rect x="13.9" y="4" width="4.6" height="16" rx="1.3" /></svg>;
export const INext = (p: P) => <svg {...solid(p)}><path d="M4 5.6v12.8a1 1 0 0 0 1.55.83l9.1-6.4a1 1 0 0 0 0-1.66l-9.1-6.4A1 1 0 0 0 4 5.6Z" /><rect x="16.6" y="4.5" width="3.2" height="15" rx="1.2" /></svg>;
export const IPrev = (p: P) => <svg {...solid(p)}><path d="M20 5.6v12.8a1 1 0 0 1-1.55.83l-9.1-6.4a1 1 0 0 1 0-1.66l9.1-6.4A1 1 0 0 1 20 5.6Z" /><rect x="4.2" y="4.5" width="3.2" height="15" rx="1.2" /></svg>;
export const IShuffle = (p: P) => <svg {...base(p)}><path d="M3 7h3.5c2 0 3.6 1 4.7 2.7l1.6 2.6C13.900 14 15.500 15 17.500 15H21" /><path d="M3 17h3.5c1.300 0 2.500-.45 3.400-1.200M14.200 8.100c.900-.700 2-1.100 3.300-1.100H21" /><path d="m18.500 4.500 2.500 2.500-2.500 2.500M18.500 12.500 21 15l-2.500 2.500" /></svg>;
export const IRepeat = (p: P) => <svg {...base(p)}><path d="M17 3.500 20 6.500l-3 3" /><path d="M4 11V9.500a3 3 0 0 1 3-3h13" /><path d="m7 20.500-3-3 3-3" /><path d="M20 13v1.500a3 3 0 0 1-3 3H4" /></svg>;
export const IRepeatOne = (p: P) => <svg {...base(p)}><path d="M17 3.500 20 6.500l-3 3" /><path d="M4 11V9.500a3 3 0 0 1 3-3h13" /><path d="m7 20.500-3-3 3-3" /><path d="M20 13v1.500a3 3 0 0 1-3 3H4" /><path d="M11.300 10.600 12.500 10v4.500" strokeWidth={1.7} /></svg>;
export const IHeart = ({ filled, ...p }: P & { filled?: boolean }) => <svg {...base(p)} fill={filled ? "currentColor" : "none"}><path d="M12 20.300S3.500 15.400 3.500 9.300A4.600 4.600 0 0 1 12 6.900a4.600 4.600 0 0 1 8.500 2.400c0 6.100-8.500 11-8.500 11Z" /></svg>;
export const IQueue = (p: P) => <svg {...base(p)}><path d="M4 6.500h12M4 11.500h12M4 16.500h7" /><path d="m15.500 14.200 5 3.050-5 3.050v-6.100Z" fill="currentColor" stroke="none" /></svg>;
export const IMore = (p: P) => <svg {...solid(p)}><circle cx="5.500" cy="12" r="1.800" /><circle cx="12" cy="12" r="1.800" /><circle cx="18.500" cy="12" r="1.800" /></svg>;
export const ISearch = (p: P) => <svg {...base(p)}><circle cx="10.800" cy="10.800" r="6.300" /><path d="m20 20-4.600-4.600" /></svg>;
export const IHome = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="8.500" /><circle cx="12" cy="12" r="2.600" /><path d="M12 3.500v2.200" /></svg>;
export const ILibrary = (p: P) => <svg {...base(p)}><rect x="3.500" y="4" width="4" height="16" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><path d="m16.800 6.300 3-.8 3.300 12.800-3 .8z" transform="translate(-2.200 0)" /></svg>;
export const IList = (p: P) => <svg {...base(p)}><path d="M4 6.500h10M4 11.500h10M4 16.500h6" /><path d="M17.500 6v9.200" /><circle cx="15.600" cy="16.300" r="2" /><path d="M17.500 6c1.800.300 3 1.300 3 3" /></svg>;
export const IChevronDown = (p: P) => <svg {...base(p)}><path d="m5.500 9 6.500 6.500L18.500 9" /></svg>;
export const IChevronRight = (p: P) => <svg {...base(p)}><path d="m9 5.500 6.500 6.500L9 18.500" /></svg>;
export const IChevronLeft = (p: P) => <svg {...base(p)}><path d="M15 5.500 8.500 12l6.500 6.500" /></svg>;
export const IClose = (p: P) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const IPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const ICheck = (p: P) => <svg {...base(p)}><path d="m4.500 12.500 5 5 10-11" /></svg>;
export const IVolume = (p: P) => <svg {...base(p)}><path d="M4 9.500v5h3.500l4.500 4v-13l-4.500 4H4Z" /><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.800 7.800 0 0 1 0 11" /></svg>;
export const IUp = (p: P) => <svg {...base(p)}><path d="m6 14.500 6-6 6 6" /></svg>;
export const IDown = (p: P) => <svg {...base(p)}><path d="m6 9.500 6 6 6-6" /></svg>;
export const ITrash = (p: P) => <svg {...base(p)}><path d="M4.500 7h15M9.500 7V4.800h5V7M6.500 7l.8 12.200h9.400L17.500 7M10 10.500v5.500M14 10.500v5.500" /></svg>;
export const IEdit = (p: P) => <svg {...base(p)}><path d="M4.500 19.500h3.800L19 8.800 15.200 5 4.500 15.700v3.800Z" /><path d="m13 7.200 3.800 3.800" /></svg>;
export const IUpload = (p: P) => <svg {...base(p)}><path d="M12 15.500V4.500M7.500 8.500 12 4l4.500 4.500" /><path d="M4.500 15v3.500a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15" /></svg>;
export const IKey = (p: P) => <svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="m11 12 8.500-8.500M16 7l2.500 2.500M13.500 9.500 15.500 11.500" /></svg>;
export const IUser = (p: P) => <svg {...base(p)}><circle cx="12" cy="8.500" r="3.800" /><path d="M4.500 20c.900-3.600 3.900-5.500 7.500-5.500s6.600 1.900 7.500 5.500" /></svg>;
export const IGear = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="2.800" /><path d="M12 3.500v2.300M12 18.200v2.300M3.500 12h2.300M18.200 12h2.300M6 6l1.600 1.600M16.400 16.400 18 18M18 6l-1.600 1.600M7.600 16.400 6 18" /></svg>;
export const IAlert = (p: P) => <svg {...base(p)}><path d="M12 4 2.800 19.500h18.400L12 4Z" /><path d="M12 10v4.500M12 17.200v.1" /></svg>;
export const IDisc = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="8.500" /><circle cx="12" cy="12" r="2.200" /></svg>;
export const IRefresh = (p: P) => <svg {...base(p)}><path d="M19.500 12a7.500 7.500 0 1 1-2.200-5.300" /><path d="M19.500 4.500v4h-4" /></svg>;
export const ISpinner = ({ size = 22, ...p }: P) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...p}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.500" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.500" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" /></path></svg>;
/** Music SP mark: a record whose groove opens into a play wedge. */
export const ILogo = ({ size = 28, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden {...p}>
    <defs><linearGradient id="msp-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs>
    <rect width="32" height="32" rx="9" fill="url(#msp-g)" />
    <circle cx="16" cy="16" r="9.200" fill="none" stroke="#150b08" strokeWidth="2.200" strokeDasharray="44 14" strokeLinecap="round" transform="rotate(-38 16 16)" />
    <path d="M13.400 11.600v8.800l7.400-4.400-7.400-4.400Z" fill="#150b08" />
  </svg>
);
