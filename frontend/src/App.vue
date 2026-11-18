<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from './stores/authStore';
import { useGameStore } from './stores/gameStore';
import PlayerView from './components/PlayerView.vue';
import HostView from './components/HostView.vue';
import QuizEditor from './components/QuizEditor.vue';
import GlassButton from './components/ui/GlassButton.vue';

const gameStore = useGameStore();
const authStore = useAuthStore();

type NavTab = 'player' | 'host' | 'library';
const activeTab = ref<NavTab>('player');
const urlPin = ref<string>('');

function syncFromUrl() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const pinParam = (params.get('pin') || '').replace(/\D/g, '').slice(0, 6);
  if (pinParam) {
    urlPin.value = pinParam;
  }

  if (path.startsWith('/host')) {
    activeTab.value = 'host';
  } else if (path.startsWith('/library')) {
    activeTab.value = 'library';
  } else if (path.startsWith('/play') || pinParam) {
    activeTab.value = 'player';
  }
}

function selectTab(tab: NavTab) {
  activeTab.value = tab;
  const targetPath =
    tab === 'player' ? '/play' : tab === 'host' ? '/host' : '/library';
  if (window.location.pathname !== targetPath) {
    window.history.replaceState({}, '', targetPath);
  }
}

onMounted(() => {
  syncFromUrl();
  window.addEventListener('popstate', syncFromUrl);
  gameStore.initSocket();
  void authStore.verifySession();
});

onUnmounted(() => {
  window.removeEventListener('popstate', syncFromUrl);
});

watch(
  () => gameStore.role,
  (newRole) => {
    if (newRole === 'host') {
      selectTab('host');
    } else if (newRole === 'player') {
      selectTab('player');
    }
  },
);
</script>

<template>
  <div class="min-h-screen flex flex-col justify-between">
    <!-- TOP NAVIGATION BAR -->
    <header class="sticky top-0 z-50 p-4">
      <nav class="max-w-6xl mx-auto px-6 py-3.5 rounded-2xl glass-panel flex flex-col sm:flex-row items-center justify-between gap-4 border border-white/15 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center text-xl shadow-[0_0_20px_rgba(168,85,247,0.5)]">
            ✨
          </div>
          <div>
            <div class="font-extrabold text-xl text-white tracking-tight flex items-center gap-2">
              <span>GlassQuiz</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 uppercase tracking-widest font-black">
                Live
              </span>
            </div>
            <div class="text-[11px] text-slate-400">Real-Time Quiz & Polling</div>
          </div>
        </div>

        <!-- Mode Navigation Tabs -->
        <div class="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10">
          <button
            @click="selectTab('player')"
            :class="[
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer select-none',
              activeTab === 'player'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white',
            ]"
          >
            📱 Player Mode
          </button>

          <button
            @click="selectTab('host')"
            :class="[
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer select-none',
              activeTab === 'host'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white',
            ]"
          >
            📺 Host Screen
          </button>

          <button
            @click="selectTab('library')"
            :class="[
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer select-none',
              activeTab === 'library'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white',
            ]"
          >
            📚 Quiz Library
          </button>
        </div>

        <!-- Connection Badge, Auth & Reset -->
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 text-xs font-medium text-slate-300">
            <span
              :class="[
                'w-2 h-2 rounded-full',
                gameStore.isConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]',
              ]"
            ></span>
            <span>{{ gameStore.isConnected ? 'Server Online' : 'Connecting...' }}</span>
          </div>

          <div
            v-if="authStore.isAuthenticated"
            class="hidden md:flex items-center gap-2 text-xs text-purple-200 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10"
          >
            <span>{{ authStore.user?.displayName }}</span>
            <button
              @click="authStore.logout()"
              class="text-slate-400 hover:text-white cursor-pointer"
              title="Sign out"
            >
              Sign out
            </button>
          </div>

          <GlassButton
            v-if="gameStore.gameState !== 'idle'"
            variant="ghost"
            size="sm"
            @click="gameStore.resetGame()"
            title="Leave current session"
          >
            Exit
          </GlassButton>
        </div>
      </nav>
    </header>

    <!-- MAIN BODY CONTENT -->
    <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
      <div v-show="activeTab === 'player'">
        <PlayerView :initial-pin="urlPin" />
      </div>

      <div v-show="activeTab === 'host'">
        <div v-if="gameStore.isPlayer" class="text-center py-16 space-y-6">
          <div class="text-5xl">🔒</div>
          <h2 class="text-3xl font-bold text-white">Player Mode Active</h2>
          <p class="text-slate-400 max-w-md mx-auto text-sm">
            You are currently participating in a live game as a player. Switch to the Player Mode tab to view questions and submit answers.
          </p>
          <GlassButton variant="primary" @click="selectTab('player')">
            Back to Player Remote ➔
          </GlassButton>
        </div>
        <div v-else-if="!gameStore.isHost || gameStore.gameState === 'idle'" class="text-center py-16 space-y-6">
          <div class="text-5xl">📺</div>
          <h2 class="text-3xl font-bold text-white">No Active Game Hosted Yet</h2>
          <p class="text-slate-400 max-w-md mx-auto text-sm">
            Visit the Quiz Library tab to choose a quiz and start hosting with a live 6-digit PIN!
          </p>
          <GlassButton variant="primary" @click="selectTab('library')">
            Go to Quiz Library ➔
          </GlassButton>
        </div>
        <HostView v-else />
      </div>

      <div v-show="activeTab === 'library'">
        <QuizEditor />
      </div>
    </main>

    <!-- FOOTER -->
    <footer class="p-6 text-center text-xs text-slate-500 border-t border-white/5">
      GlassQuiz • Built with Vue 3, NestJS, WebSockets & Glassmorphism
    </footer>
  </div>
</template>
