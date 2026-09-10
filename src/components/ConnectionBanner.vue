<script lang="ts" setup>
import { useGroupStore } from '../stores/groupStore'

const store = useGroupStore()
</script>

<template>
  <div
    v-if="
      store.connection !== 'online' &&
      (store.phase === 'lobby' ||
        store.phase === 'starting' ||
        store.phase === 'question' ||
        store.phase === 'connecting')
    "
    class="alert py-2"
    :class="store.connection === 'failed' ? 'alert-error' : 'alert-warning'"
  >
    <span
      v-if="store.connection === 'reconnecting'"
      class="loading loading-spinner loading-sm"
    ></span>
    <span class="text-sm font-medium">
      {{
        store.connection === 'failed'
          ? 'Connection lost. The server may be waking up.'
          : 'Reconnecting… your seat is held.'
      }}
    </span>
    <button v-if="store.connection === 'failed'" class="btn btn-soft btn-sm" @click="store.retryNow()">
      Retry now
    </button>
  </div>
</template>
