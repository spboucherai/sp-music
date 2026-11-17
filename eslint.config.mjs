import next from "eslint-config-next";

export default [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "data/**"] },
  ...next,
  {
    rules: {
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",
      // Browser-only state (theme, time zone, fetched data) is read in effects on purpose, to keep SSR output stable.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      // The player keeps imperative state next to an <audio> element (mutually recursive callbacks, shuffle).
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      // After sign-in / sign-out the page is reloaded on purpose (new session cookie, server layout re-evaluated).
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
];
