<script setup lang="ts">
defineProps<{
  modelValue: string;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  className?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();
</script>

<template>
  <input
    :type="type || 'text'"
    :value="modelValue"
    :placeholder="placeholder"
    :maxlength="maxLength"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    :class="[
      'glass-input w-full px-5 py-3.5 rounded-xl text-lg font-medium placeholder:text-slate-400/70 outline-none transition-all duration-200',
      className,
    ]"
  />
</template>
