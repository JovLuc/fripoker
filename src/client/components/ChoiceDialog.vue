<script setup lang="ts">
/** One reusable choice dialog: fixed mask + `.panel.narrow` (base.css shell). */
export interface DialogOption {
  key: string;
  label: string;
  /** Optional trailing detail, e.g. chips or a rules hint. */
  sub?: string;
}

defineProps<{
  title: string;
  /** Small caption above the title (e.g. fee). */
  label?: string;
  options: DialogOption[];
}>();

const emit = defineEmits<{
  choose: [key: string];
  cancel: [];
}>();
</script>

<template>
  <div class="dialog-mask" @click.self="emit('cancel')">
    <div class="panel narrow">
      <p v-if="label" class="label">{{ label }}</p>
      <h2 class="title">{{ title }}</h2>
      <div class="dialog-options">
        <button
          v-for="o in options"
          :key="o.key"
          class="btn block"
          type="button"
          @click="emit('choose', o.key)"
        >{{ o.label }}<span v-if="o.sub" class="dim"> · {{ o.sub }}</span></button>
      </div>
      <button class="btn ghost block" type="button" @click="emit('cancel')">取消</button>
    </div>
  </div>
</template>
