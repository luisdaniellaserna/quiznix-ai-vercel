<script lang="ts" setup>
import { nextTick, ref, watch } from 'vue'
import { useGroupStore } from '../stores/groupStore'

const store = useGroupStore()
const draft = ref('')
const listRef = ref<HTMLDivElement | null>(null)
let stickToBottom = true

function onScroll() {
  const el = listRef.value
  if (!el) return
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

watch(
  () => store.chatMessages.length,
  () => {
    if (!stickToBottom) return
    void nextTick(() => {
      const el = listRef.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)

function isOwn(senderId: string, role: 'host' | 'player') {
  if (role === 'host') return store.role === 'host'
  return store.playerId !== null && senderId === store.playerId
}

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function send() {
  if (!draft.value.trim()) return
  store.sendChat(draft.value)
  draft.value = ''
}
</script>

<template>
  <div class="card bg-base-200/60 shadow-xl">
    <div class="card-body gap-3 p-4">
      <h3 class="text-sm font-bold tracking-wider uppercase opacity-70">Group chat</h3>
      <div ref="listRef" class="max-h-56 space-y-2 overflow-y-auto pr-1" @scroll="onScroll">
        <p v-if="store.chatMessages.length === 0" class="text-sm opacity-60">
          No messages yet — say hi to the room!
        </p>
        <div
          v-for="m in store.chatMessages"
          :key="m.id"
          class="chat"
          :class="isOwn(m.senderId, m.role) ? 'chat-end' : 'chat-start'"
        >
          <div class="chat-header flex items-center gap-1 text-xs opacity-70">
            {{ m.name }}
            <span v-if="m.role === 'host'" class="badge badge-secondary badge-xs">host</span>
            <time>{{ formatTime(m.at) }}</time>
          </div>
          <div
            class="chat-bubble text-sm break-words"
            :class="isOwn(m.senderId, m.role) ? 'chat-bubble-primary' : ''"
          >
            {{ m.text }}
          </div>
        </div>
      </div>
      <form class="flex gap-2" @submit.prevent="send">
        <input
          v-model="draft"
          type="text"
          maxlength="200"
          placeholder="Message the lobby…"
          class="input input-bordered input-sm flex-1"
          autocomplete="off"
        />
        <button type="submit" class="btn btn-primary btn-sm" :disabled="!draft.trim()">Send</button>
      </form>
      <p class="text-xs opacity-50">Lobby-only · history stays in this browser</p>
    </div>
  </div>
</template>
