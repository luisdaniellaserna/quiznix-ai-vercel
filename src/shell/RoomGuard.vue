<script lang="ts" setup>
import { nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useGroupStore } from '../stores/groupStore'

/**
 * Cross-tab room protection: if another tab takes over this browser's room slot,
 * say so from anywhere in the app.
 *
 * This lives in the shell rather than inside the quiz because the eviction can
 * land while the player is parked on the dashboard. The store owns the cleanup
 * (it closes the socket and clears the resume state) — this only surfaces it.
 */
const groupStore = useGroupStore()
const router = useRouter()
const evictedDialogRef = ref<HTMLDialogElement | null>(null)

watch(
  () => groupStore.evictedMessage,
  (msg) => {
    void nextTick(() => {
      if (msg) {
        if (!evictedDialogRef.value?.open) evictedDialogRef.value?.showModal()
      } else {
        evictedDialogRef.value?.close()
      }
    })
  },
)

function dismiss() {
  evictedDialogRef.value?.close()
  groupStore.leave()
  void router.push('/')
}
</script>

<template>
  <dialog ref="evictedDialogRef" class="modal">
    <div class="modal-box">
      <h3 class="text-lg font-bold">Switched rooms</h3>
      <p class="py-3 text-sm opacity-80">
        {{ groupStore.evictedMessage || 'Another tab took over this session.' }}
      </p>
      <div class="modal-action">
        <button class="btn btn-soft btn-primary" @click="dismiss">Back to games</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
