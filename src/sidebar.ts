export abstract class LayoutElement {
  name: string;
  constructor(args: { name: string }) {
    this.name = args.name;
  }
  abstract render(): string;
}

export class TextContent extends LayoutElement {
  content: string;

  constructor(args: { name?: string; content: string }) {
    super({ name: args.name || "" });
    this.content = args.content;
  }

  render(): string {
    return this.content;
  }
}

export class Paragraph extends LayoutElement {
  content: string;
  cssClass?: string;

  constructor(args: { name?: string; content: string; cssClass?: string }) {
    super({ name: args.name || "" });
    this.content = args.content;
    this.cssClass = args.cssClass;
  }

  render(): string {
    const classAttr = this.cssClass ? ` class="${this.cssClass}"` : "";
    return `<p${classAttr}>${this.content}</p>`;
  }
}

export class SidebarItem extends LayoutElement {
  icon?: string;
  content: string;

  constructor(args: { name: string; content: string; icon?: string }) {
    super({ name: args.name });
    this.icon = args.icon;
    this.content = args.content;
  }

  render(): string {
    const iconHTML = this.icon
      ? `<i class="w-icon ${this.icon} ev-charger-item-icon"></i>`
      : "";
    return `<wz-card class="ev-charger-item" size="sm" elevation="0"><div class="ev-charger-item-header">${iconHTML}<wz-subhead5 class="ev-charger-item-title">${this.name}</wz-subhead5></div><div class="ev-charger-item-content"><p>${this.content}</p></div></wz-card>`;
  }
}

export class SidebarSection extends LayoutElement {
  children: LayoutElement[];
  cssClass?: string;

  constructor(args: {
    name: string;
    children?: LayoutElement[];
    cssClass?: string;
  }) {
    super({ name: args.name });
    this.children = args.children || [];
    this.cssClass = args.cssClass;
  }

  addChild(child: LayoutElement): this {
    this.children.push(child);
    return this;
  }

  render(): string {
    const childrenHTML = this.children.map((child) => child.render()).join("");
    const classAttr = this.cssClass ? ` ${this.cssClass}` : "";
    return `<div class="section${classAttr}"><div><wz-subhead4 class="title--gltyL">${this.name}</wz-subhead4><div class="content--CrePr">${childrenHTML}</div></div></div>`;
  }
}

export class SidebarTab {
  scriptName: string;
  children: LayoutElement[];

  constructor(args: { scriptName: string; children?: LayoutElement[] }) {
    this.scriptName = args.scriptName;
    this.children = args.children || [];
  }

  addChild(child: LayoutElement): this {
    this.children.push(child);
    return this;
  }

  render(): string {
    const childrenHTML = this.children.map((child) => child.render()).join("");
    return `<div class="sidebar-tab-pane-body">${childrenHTML}</div>`;
  }
}
