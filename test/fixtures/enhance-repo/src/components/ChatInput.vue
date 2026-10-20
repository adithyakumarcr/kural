<script setup lang="ts">
import { ref } from "vue";
import { ApiClient } from "../api/client";

const props = defineProps<{ api: ApiClient }>();
const text = ref("");
const sending = ref(false);

async function send() {
  if (!text.value.trim()) return;
  sending.value = true;
  try { await props.api.sendChat(text.value); text.value = ""; } finally { sending.value = false; }
}
</script>

<template>
  <div class="chat-input">
    <textarea v-model="text" placeholder="Ask about the current job" @keydown.enter.exact.prevent="send" />
    <button class="send" :disabled="sending" @click="send">Send</button>
  </div>
</template>
