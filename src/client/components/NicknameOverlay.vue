<script setup lang="ts">
import { ref } from "vue";
import { error } from "../stores/error.js";
import { profile } from "../stores/profile.js";
import { submitNickname } from "../stores/session.js";

const nickInput = ref("");

function submit(): void {
  submitNickname(nickInput.value);
}
</script>

<template>
  <div class="overlay">
    <div class="panel narrow">
      <p class="label">首次进入</p>
      <h1 class="title">设置昵称</h1>
      <input
        v-model="nickInput"
        class="input"
        maxlength="16"
        placeholder="昵称"
        @keyup.enter="submit"
      />
      <button class="btn primary block" @click="submit">进入</button>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>
