export interface DialogButton {
  label: string;
  value: string;
}

export function showWmeDialog(args: {
  message: string;
  buttons: DialogButton[];
}): Promise<string> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.background = '#fff';
    modal.style.padding = '20px';
    modal.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
    modal.style.zIndex = '10000';
    modal.style.borderRadius = '6px';
    modal.style.textAlign = 'center';
    modal.style.minWidth = '200px';

    const msg = document.createElement('p');
    msg.innerHTML = args.message;
    modal.appendChild(msg);

    for (const { label, value } of args.buttons) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className = 'btn btn-default';
      btn.style.margin = '5px';
      btn.onclick = () => {
        modal.remove();
        resolve(value);
      };
      modal.appendChild(btn);
    }

    document.body.appendChild(modal);
  });
}
