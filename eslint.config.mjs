/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : eslint.config.mjs
 * Repository       : https://git.spboucher.ai/sp-music
 * Project Website  : https://music.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
