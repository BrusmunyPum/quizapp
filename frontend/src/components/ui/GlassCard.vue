<script setup lang="ts">
withDefaults(
  defineProps<{
    interactive?: boolean;
    className?: string;
  }>(),
  {
    interactive: false,
    className: '',
  }
);
</script>

<template>
  <div
    :class="[
      interactive ? 'glass-card-interactive' : 'glass-panel',
      'p-6 sm:p-8 backdrop-blur-xl transition-all duration-300',
      className,
    ]"
  >
    <slot />
  </div>
</template>
