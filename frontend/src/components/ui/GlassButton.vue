<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    className?: string;
  }>(),
  {
    variant: 'primary',
    size: 'md',
    disabled: false,
    className: '',
  }
);
</script>

<template>
  <button
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
      // Size variants
      size === 'sm' ? 'px-3 py-1.5 text-sm gap-1.5' : '',
      size === 'md' ? 'px-5 py-2.5 text-base gap-2' : '',
      size === 'lg' ? 'px-8 py-3.5 text-lg gap-3 rounded-2xl shadow-xl' : '',
      // Color variants
      variant === 'primary'
        ? 'bg-gradient-to-r from-purple-600/80 to-indigo-600/80 hover:from-purple-500/90 hover:to-indigo-500/90 text-white border border-purple-400/30 shadow-[0_0_20px_rgba(168,85,247,0.35)] hover:shadow-[0_0_30px_rgba(168,85,247,0.55)] active:scale-95'
        : '',
      variant === 'secondary'
        ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20 shadow-md hover:border-white/40 active:scale-95'
        : '',
      variant === 'danger'
        ? 'bg-red-500/20 hover:bg-red-500/35 text-red-200 border border-red-500/40 active:scale-95'
        : '',
      variant === 'ghost'
        ? 'bg-transparent hover:bg-white/10 text-slate-300 hover:text-white'
        : '',
      className,
    ]"
  >
    <slot />
  </button>
</template>
