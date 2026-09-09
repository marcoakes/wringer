/** Existing components. Use these exports; do not replace this protected library. */
export function button(label: string, onClick: () => void, kind = "primary"): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button"; element.className = `button ${kind}`; element.textContent = label;
    element.addEventListener("click", onClick); return element;
}
export function statusBadge(status: string): HTMLElement {
    const badge = document.createElement("span"); badge.className = "status";
    badge.dataset.status = status; badge.textContent = status; return badge;
}
export function reportCard(title: string): HTMLElement {
    const card = document.createElement("article"); card.className = "report-card";
    const heading = document.createElement("h2"); heading.textContent = title; card.append(heading); return card;
}
export function workspace(title: string, intro: string): HTMLElement {
    const section = document.createElement("section"); section.className = "workspace";
    const eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = "Northstar / workspace";
    const heading = document.createElement("h1"); heading.textContent = title;
    const description = document.createElement("p"); description.className = "intro"; description.textContent = intro;
    section.append(eyebrow, heading, description); return section;
}
