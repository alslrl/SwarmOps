// editor-chat.js — Chat messages and runs list UI

import { chatMessagesEl } from './editor-dom.js';
import { currentSlideFile, getSlideState, randomId, escapeHtml, formatTime } from './editor-utils.js';

export function addChatMessage(kind, text, slide = currentSlideFile()) {
  if (!slide) return;

  const state = getSlideState(slide);
  state.messages.push({
    id: randomId('msg'),
    kind,
    text,
    at: new Date().toISOString(),
  });

  while (state.messages.length > 80) {
    state.messages.shift();
  }

  if (slide === currentSlideFile()) {
    renderChatMessages();
  }
}

export function renderChatMessages() {
  if (!chatMessagesEl) return;
  const slide = currentSlideFile();
  if (!slide) {
    chatMessagesEl.innerHTML = '';
    return;
  }

  const state = getSlideState(slide);
  const messages = Array.isArray(state.messages) ? state.messages : [];
  if (messages.length === 0) {
    chatMessagesEl.innerHTML = '';
    return;
  }

  chatMessagesEl.innerHTML = messages
    .map((msg) => {
      const time = formatTime(msg.at);
      return [
        `<div class="message ${msg.kind}">`,
        `${escapeHtml(msg.text)}`,
        `<div class="run-meta" style="margin-top:6px;">${time}</div>`,
        '</div>',
      ].join('');
    })
    .join('');

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

export function renderRunsList() {}
