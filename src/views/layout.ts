import { escape, html } from "../lib/http";

type PageScript = { src: string; module?: boolean };

type PageDocument = {
  title: string;
  body: string;
  scripts?: PageScript[];
};

type TopBar = {
  session: string;
  emphasis?: string;
  backHref?: string;
};

type PageHeader = {
  eyebrow: string;
  title: string;
  lede: string;
  actions?: string;
};

export const pageDocument = ({ title, body, scripts = [] }: PageDocument) =>
  html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="/styles.css">${scripts.map(({ src, module }) => `<script${module ? ' type="module"' : ""} src="${escape(src)}"></script>`).join("")}${body}</html>`,
  );

export const topBarView = ({ session, emphasis, backHref }: TopBar) =>
  `<header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">${escape(session)}${emphasis ? ` <strong>${escape(emphasis)}</strong>` : ""}</span>${backHref ? `<a class="button back-button" href="${escape(backHref)}">Back</a>` : ""}</header>`;

export const pageHeaderView = ({ eyebrow, title, lede, actions }: PageHeader) =>
  `<div class="page-header"><div><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1><p class="lede">${escape(lede)}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ""}</div>`;

export const secondaryLinkView = (href: string, label: string) =>
  `<a class="button button-secondary" href="${escape(href)}">${escape(label)}</a>`;
