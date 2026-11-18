<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import confetti from 'canvas-confetti';
import { useGameStore } from '../stores/gameStore';
import GlassCard from './ui/GlassCard.vue';
import GlassButton from './ui/GlassButton.vue';

const gameStore = useGameStore();
const linkCopied = ref(false);

const timerPercent = computed(() => {
  if (!gameStore.currentQuestion || gameStore.currentQuestion.timeLimitSeconds === 0) return 0;
  return Math.min(
    100,
    Math.max(0, (gameStore.timeRemaining / gameStore.currentQuestion.timeLimitSeconds) * 100),
  );
});

const isLastQuestion = computed(() => {
  const q = gameStore.currentQuestion;
  if (!q || !q.questionNumber || !q.totalQuestions) return false;
  return q.questionNumber >= q.totalQuestions;
});

function getOptionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

function isOptionCorrect(optionId: string): boolean {
  const ids = gameStore.questionResults?.correctOptionIds;
  if (ids && ids.length > 0) {
    return ids.includes(optionId);
  }
  return optionId === gameStore.questionResults?.correctOptionId;
}

async function copyJoinLink() {
  if (!gameStore.roomPin) return;
  const joinUrl = `${window.location.origin}/play?pin=${gameStore.roomPin}`;
  try {
    await navigator.clipboard.writeText(joinUrl);
    linkCopied.value = true;
    window.setTimeout(() => {
      linkCopied.value = false;
    }, 2000);
  } catch {
    // Fallback if clipboard API unavailable
  }
}

watch(
  () => gameStore.gameState,
  (newState) => {
    if (newState === 'podium') {
      confetti({
        particleCount: 120,
        spread: 90,
        origin: { y: 0.6 },
      });
    }
  },
);

const optionColors = [
  'border-rose-500/50 bg-rose-500/10 text-rose-200',
  'border-sky-500/50 bg-sky-500/10 text-sky-200',
  'border-amber-500/50 bg-amber-500/10 text-amber-200',
  'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
  'border-purple-500/50 bg-purple-500/10 text-purple-200',
  'border-pink-500/50 bg-pink-500/10 text-pink-200',
];
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-8 animate-fadeIn">
    <!-- LOBBY SCREEN -->
    <div v-if="gameStore.gameState === 'lobby'" class="text-center space-y-8">
      <GlassCard className="py-12 border-purple-500/30 shadow-[0_0_50px_rgba(168,85,247,0.25)]">
        <span class="inline-block px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40 mb-4">
          Live Game Lobby
        </span>
        <h1 class="text-3xl sm:text-5xl font-extrabold text-white mb-2">
          {{ gameStore.quizTitle || 'Join the Quiz' }}
        </h1>
        <p class="text-slate-300 mb-6">Join on your phone or browser using the Game PIN:</p>

        <!-- Huge Glowing PIN -->
        <div class="inline-flex items-center gap-4 px-8 py-4 rounded-3xl bg-black/40 border-2 border-purple-400/50 shadow-[0_0_35px_rgba(168,85,247,0.4)]">
          <span class="text-5xl sm:text-7xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-pink-200 to-indigo-300">
            {{ gameStore.roomPin }}
          </span>
        </div>

        <div class="mt-4">
          <GlassButton variant="secondary" size="sm" @click="copyJoinLink">
            {{ linkCopied ? '✓ Invite Link Copied' : '🔗 Copy Invite Link' }}
          </GlassButton>
        </div>

        <div v-if="gameStore.errorMessage" role="alert" class="mt-4 max-w-md mx-auto p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-sm">
          {{ gameStore.errorMessage }}
        </div>

        <div class="mt-8 flex justify-center">
          <GlassButton
            size="lg"
            :disabled="gameStore.players.length === 0"
            @click="gameStore.startGame()"
          >
            🚀 Start Game ({{ gameStore.players.length }} Joined)
          </GlassButton>
        </div>
      </GlassCard>

      <!-- Player badges list -->
      <GlassCard>
        <div class="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
          <h2 class="text-xl font-bold flex items-center gap-2">
            <span>👥 Connected Players</span>
            <span class="px-2.5 py-0.5 rounded-full text-xs bg-indigo-500/30 text-indigo-300 border border-indigo-400/40">
              {{ gameStore.players.length }}
            </span>
          </h2>
          <span class="text-sm text-slate-400">Waiting for players to join...</span>
        </div>

        <div v-if="gameStore.players.length === 0" class="py-8 text-slate-400 text-center">
          No players joined yet. Tell participants to enter PIN <strong class="text-purple-300">{{ gameStore.roomPin }}</strong>!
        </div>

        <div v-else class="flex flex-wrap gap-3 justify-center">
          <div
            v-for="p in gameStore.players"
            :key="p.nickname"
            class="px-5 py-2.5 rounded-2xl bg-white/10 border border-white/20 font-semibold text-white shadow-md flex items-center gap-2 animate-bounce-short"
          >
            <span
              :class="[
                'w-2.5 h-2.5 rounded-full',
                p.connected === false
                  ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                  : 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
              ]"
            ></span>
            <span>{{ p.nickname }}</span>
          </div>
        </div>
      </GlassCard>
    </div>

    <!-- QUESTION ACTIVE SCREEN -->
    <div v-else-if="gameStore.gameState === 'question'" class="space-y-6">
      <GlassCard className="relative overflow-hidden">
        <!-- Progress bar timer -->
        <div class="absolute top-0 left-0 right-0 h-2 bg-white/10">
          <div
            class="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300 ease-linear shadow-[0_0_15px_rgba(236,72,153,0.8)]"
            :style="{ width: `${timerPercent}%` }"
          ></div>
        </div>

        <div class="flex items-center justify-between text-slate-400 text-sm font-medium mb-4 mt-2">
          <span>Question {{ gameStore.currentQuestion?.questionNumber }} of {{ gameStore.currentQuestion?.totalQuestions }}</span>
          <div class="flex items-center gap-2">
            <span class="text-xl font-black text-amber-300">{{ gameStore.timeRemaining }}s</span>
            <span class="text-xs uppercase tracking-wider text-slate-400">remaining</span>
          </div>
        </div>

        <!-- Optional Question Image -->
        <div v-if="gameStore.currentQuestion?.mediaUrl" class="flex justify-center mb-4">
          <img
            :src="gameStore.currentQuestion.mediaUrl"
            alt="Question media"
            class="max-h-56 rounded-xl border border-white/15 object-contain"
          />
        </div>

        <!-- Question Title -->
        <h2 class="text-2xl sm:text-4xl font-extrabold text-white text-center py-6 leading-tight">
          {{ gameStore.currentQuestion?.prompt }}
        </h2>

        <!-- Answer status bar + End Early -->
        <div class="flex flex-wrap justify-between items-center gap-3 pt-2 text-sm text-slate-300">
          <span class="px-3 py-1 rounded-full bg-white/10 border border-white/20">
            Answers: <strong class="text-purple-300">{{ gameStore.answerCount }}</strong> / {{ gameStore.totalPlayersInRoom }}
          </span>
          <GlassButton variant="secondary" size="sm" @click="gameStore.endQuestionEarly()">
            End Question Early
          </GlassButton>
        </div>
      </GlassCard>

      <!-- Option Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          v-for="(opt, idx) in gameStore.currentQuestion?.options"
          :key="opt.id"
          :class="[
            'p-6 rounded-2xl border backdrop-blur-xl shadow-lg flex items-center gap-4 transition-all',
            optionColors[idx % optionColors.length],
          ]"
        >
          <div class="w-10 h-10 shrink-0 rounded-xl bg-white/15 border border-white/30 flex items-center justify-center font-black text-lg">
            {{ getOptionLabel(idx) }}
          </div>
          <span class="text-xl font-semibold text-white">{{ opt.content }}</span>
        </div>
      </div>
    </div>

    <!-- QUESTION RESULTS SCREEN -->
    <div v-else-if="gameStore.gameState === 'result'" class="space-y-6">
      <GlassCard className="text-center space-y-6">
        <h2 class="text-3xl font-extrabold text-white">Question Results</h2>

        <!-- Options breakdown -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
          <div
            v-for="(opt, idx) in gameStore.currentQuestion?.options"
            :key="opt.id"
            :class="[
              'p-5 rounded-2xl border transition-all flex items-center justify-between',
              isOptionCorrect(opt.id)
                ? 'bg-emerald-500/20 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
                : 'bg-white/5 border-white/10 opacity-60',
            ]"
          >
            <div class="flex items-center gap-3">
              <span class="w-8 h-8 shrink-0 rounded-lg bg-white/15 flex items-center justify-center font-bold">
                {{ getOptionLabel(idx) }}
              </span>
              <span class="font-semibold text-white">{{ opt.content }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs px-2.5 py-1 rounded-full bg-white/10 font-bold">
                {{ gameStore.questionResults?.optionCounts?.[opt.id] || 0 }} votes
              </span>
              <span v-if="isOptionCorrect(opt.id)" class="text-emerald-400 text-lg">
                ✓
              </span>
            </div>
          </div>
        </div>

        <!-- Top 5 Leaderboard -->
        <div class="mt-8 text-left space-y-3">
          <h3 class="text-lg font-bold text-slate-300 uppercase tracking-wider">🏆 Leaderboard Top 5</h3>
          <div
            v-for="entry in gameStore.questionResults?.leaderboard"
            :key="entry.nickname"
            class="flex items-center justify-between p-3.5 rounded-xl bg-white/10 border border-white/15"
          >
            <div class="flex items-center gap-3">
              <span class="w-7 h-7 rounded-full bg-purple-500/40 text-purple-200 font-extrabold flex items-center justify-center text-sm">
                #{{ entry.rank }}
              </span>
              <span class="font-bold text-white text-base">{{ entry.nickname }}</span>
              <span v-if="entry.streak && entry.streak > 1" class="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                🔥 {{ entry.streak }} streak
              </span>
            </div>
            <span class="text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-indigo-200">
              {{ entry.score.toLocaleString() }} pts
            </span>
          </div>
        </div>

        <div class="pt-4 flex justify-end">
          <GlassButton size="lg" @click="gameStore.nextQuestion()">
            {{ isLastQuestion ? 'Show Final Podium 🏆' : 'Next Question ➔' }}
          </GlassButton>
        </div>
      </GlassCard>
    </div>

    <!-- PODIUM / FINAL SCREEN -->
    <div v-else-if="gameStore.gameState === 'podium'" class="text-center space-y-8">
      <GlassCard className="py-12 border-amber-500/40 shadow-[0_0_50px_rgba(245,158,11,0.2)]">
        <span class="text-4xl">👑</span>
        <h1 class="text-4xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 mb-8">
          Quiz Champions!
        </h1>

        <div v-if="gameStore.podium.length === 0" class="text-slate-300 py-8">
          No scores recorded in this session.
        </div>

        <!-- Podium columns -->
        <div v-else class="flex justify-center items-end gap-4 sm:gap-8 max-w-xl mx-auto my-8 h-64">
          <!-- 2nd Place -->
          <div v-if="gameStore.podium[1]" class="flex-1 flex flex-col items-center">
            <span class="text-xl mb-1">🥈</span>
            <div class="font-bold text-white truncate max-w-[120px]">{{ gameStore.podium[1].nickname }}</div>
            <div class="text-xs text-slate-300 mb-2">{{ gameStore.podium[1].score.toLocaleString() }} pts</div>
            <div class="w-full h-36 rounded-t-2xl bg-gradient-to-t from-slate-700/80 to-slate-500/80 border-t-2 border-slate-300/60 flex items-center justify-center font-black text-3xl text-slate-200 shadow-lg">
              2
            </div>
          </div>

          <!-- 1st Place -->
          <div v-if="gameStore.podium[0]" class="flex-1 flex flex-col items-center">
            <span class="text-3xl mb-1 animate-bounce">🥇</span>
            <div class="font-extrabold text-amber-200 text-lg truncate max-w-[130px]">{{ gameStore.podium[0].nickname }}</div>
            <div class="text-xs text-amber-300/80 mb-2 font-bold">{{ gameStore.podium[0].score.toLocaleString() }} pts</div>
            <div class="w-full h-48 rounded-t-2xl bg-gradient-to-t from-amber-600/80 to-yellow-500/80 border-t-2 border-yellow-200/80 flex items-center justify-center font-black text-4xl text-amber-950 shadow-[0_0_30px_rgba(245,158,11,0.5)]">
              1
            </div>
          </div>

          <!-- 3rd Place -->
          <div v-if="gameStore.podium[2]" class="flex-1 flex flex-col items-center">
            <span class="text-xl mb-1">🥉</span>
            <div class="font-bold text-amber-500 truncate max-w-[120px]">{{ gameStore.podium[2].nickname }}</div>
            <div class="text-xs text-slate-300 mb-2">{{ gameStore.podium[2].score.toLocaleString() }} pts</div>
            <div class="w-full h-24 rounded-t-2xl bg-gradient-to-t from-amber-800/80 to-amber-700/80 border-t-2 border-amber-600/60 flex items-center justify-center font-black text-2xl text-amber-200 shadow-md">
              3
            </div>
          </div>
        </div>

        <div class="mt-8 flex justify-center gap-4">
          <GlassButton size="lg" @click="gameStore.resetGame()">
            Back to Dashboard
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  </div>
</template>
