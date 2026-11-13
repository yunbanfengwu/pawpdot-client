const host = window.pawpdotPetHost;
const adoption = document.querySelector('#adoption');
const homePet = document.querySelector('#home-pet');
const options = document.querySelector('#pet-options');
const nameNode = document.querySelector('#pet-name');
const statusNode = document.querySelector('#pet-status');
const candidates = [
  { id: 'cloud-cat', name: '云朵猫', detail: '安静、好奇，喜欢陪你整理思路' },
  { id: 'sunny-dog', name: '晴天犬', detail: '热情、可靠，适合一起规划一天' },
  { id: 'moon-rabbit', name: '月兔', detail: '温柔、敏锐，擅长陪你专注' },
];
let state = { selected: null, action: 'idle' };

function renderOptions() {
  options.replaceChildren(...candidates.map(pet => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pet-option';
    button.addEventListener('click', () => host.adopt(pet.id));
    const visual = document.createElement('span');
    visual.className = 'pet-option-visual';
    visual.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'pet-option-copy';
    copy.append(Object.assign(document.createElement('strong'), { textContent: pet.name }));
    copy.append(Object.assign(document.createElement('span'), { textContent: pet.detail }));
    const action = document.createElement('span');
    action.className = 'pet-option-action';
    action.textContent = '领养';
    button.append(visual, copy, action);
    return button;
  }));
}

function render(next) {
  state = next;
  const selected = candidates.find(pet => pet.id === state.selected);
  adoption.hidden = Boolean(selected) && !state.adoptionOpen;
  homePet.hidden = !selected;
  if (!selected) {
    renderOptions();
    return;
  }
  nameNode.textContent = selected.name;
  statusNode.textContent = state.action === 'listening' ? '正在聆听' :
    state.action === 'speaking' ? '正在回应' : '在首页陪伴你';
}

document.querySelector('#close-adoption').addEventListener('click', () => {
  host.closeAdoption();
});
document.querySelector('#pet-change').addEventListener('click', () => {
  adoption.hidden = false;
});
document.querySelector('#pet-talk').addEventListener('click', () => host.setAction('listening'));
host.onSnapshot(render);
