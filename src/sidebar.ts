export abstract class LayoutElement {
  name: string;
  constructor(args: { name: string }) {
    this.name = args.name;
  }
  abstract render(args: { content: string }): string;
}

export class SidebarSection extends LayoutElement {
  icon: string;
  constructor(args: { name: string; icon: string }) {
    super({ name: args.name });
    this.icon = args.icon;
  }
  render(args: { content: string }): string {
    return `<div><wz-section-header headline="${this.name}" size="section-header2" back-button="false"><i slot="icon" class="w-icon ${this.icon}"></i></wz-section-header>${args.content}<div>`;
  }
}
