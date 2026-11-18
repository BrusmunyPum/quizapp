<script setup lang="ts">
import { ref, watch } from 'vue';
import { useGameStore } from '../stores/gameStore';
import GlassCard from './ui/GlassCard.vue';
import GlassButton from './ui/GlassButton.vue';
import GlassInput from './ui/GlassInput.vue';

const props = defineProps<{
  initialPin?: string;
}>();

const gameStore = useGameStore();

const pin = ref(props.initialPin || '');
const nickname = ref('');

watch(
  () => props.initialPin,
  (newPin) => {
    if (newPin && gameStore.gameState === 'idle') {
      pin.value = newPin;
    }
  },
);

function handleJoin() {
  const cleanPin = pin.value.replace(/\D/g, '').slice(0, 6);
  const cleanNick = nickname.value.trim();
  if (cleanPin.length !== 6 || !cleanNick) {
    gameStore.errorMessage = 'Enter a 6-digit Game PIN and a nickname.';
    return;
  }
  gameStore.joinRoom(cleanPin, cleanNick);
}

const optionStyles = [
  'glass-opt-red',
  'glass-opt-blue',
  'glass-opt-yellow',
  'glass-opt-green',
];

const optionSymbols = ['▲', '◆', '●', '■', '★', '✦'];
</script>

<template>
  <div class="max-w-md mx-auto space-y-6">
    <!-- Host temporary disconnect notice -->
    <div
      v-if="gameStore.gameState !== 'idle' && !gameStore.hostConnected"
      role="status"
      class="p-3 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-200 text-xs text-center"
    >
      Host temporarily disconnected. Waiting for host to reconnect...
    </div>

    <!-- 1. JOIN GAME FORM -->
    <GlassCard v-if="gameStore.gameState === 'idle'" className="text-center py-10 space-y-6">
      <div class="space-y-2">
        <span class="text-4xl">📱</span>
        <h1 class="text-2xl sm:text-3xl font-extrabold text-white">Join a Quiz</h1>
        <p class="text-sm text-slate-300">Enter the game PIN shown on the host screen</p>
      </div>

      <form class="space-y-4 text-left" @submit.prevent="handleJoin">
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Game PIN</label>
          <GlassInput
            v-model="pin"
            placeholder="6-digit PIN"
            inputmode="numeric"
            :max-length="6"
            className="text-center font-bold tracking-widest text-2xl"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Your Nickname</label>
          <GlassInput
            v-model="nickname"
            placeholder="e.g. MasterCoder"
            :max-length="20"
          />
        </div>

        <div
          v-if="gameStore.errorMessage"
          role="alert"
          class="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-sm text-center"
        >
          {{ gameStore.errorMessage }}
        </div>

        <GlassButton
          type="submit"
          variant="primary"
          size="lg"
          className="w-full mt-2"
          :disabled="!pin.trim() || !nickname.trim() || !gameStore.isConnected"
        >
          {{ gameStore.isConnected ? 'Enter Game ➔' : 'Connecting to server...' }}
        </GlassButton>
      </form>
    </GlassCard>

    <!-- 2. PLAYER WAITING LOBBY -->
    <GlassCard v-else-if="gameStore.gameState === 'lobby'" className="text-center py-12 space-y-6">
      <div class="w-20 h-20 mx-auto rounded-full bg-purple-500/20 border-2 border-purple-400/60 flex items-center justify-center text-3xl animate-pulse">
        ✨
      </div>
      <div>
        <h2 class="text-2xl font-black text-white">You're In!</h2>
        <p class="text-slate-300 text-sm mt-1">See your nickname on the big screen?</p>
      </div>

      <div class="inline-block px-6 py-2.5 rounded-2xl bg-white/10 border border-white/20 font-bold text-lg text-purple-200">
        {{ gameStore.playerNickname }}
      </div>

      <div class="pt-4 text-xs text-slate-400">
        Waiting for the host to start the game...
      </div>
    </GlassCard>

    <!-- 3. QUESTION ANSWER PADS -->
    <div v-else-if="gameStore.gameState === 'question'" class="space-y-4">
      <div class="flex items-center justify-between px-2 text-sm text-slate-300 font-medium">
        <span>Question {{ gameStore.currentQuestion?.questionNumber }} of {{ gameStore.currentQuestion?.totalQuestions }}</span>
        <span class="font-extrabold text-amber-300">{{ gameStore.timeRemaining }}s left</span>
      </div>

      <GlassCard className="py-4 text-center font-bold text-white text-base">
        {{ gameStore.currentQuestion?.prompt }}
      </GlassCard>

      <GlassCard v-if="gameStore.hasSubmittedAnswer" className="text-center py-12 space-y-3 border-indigo-500/40">
        <div class="text-4xl animate-bounce">⚡</div>
        <h3 class="text-xl font-black text-white">Answer Locked In!</h3>
        <p class="text-xs text-slate-300">Hang tight while others finish answering...</p>
      </GlassCard>

      <GlassCard v-else-if="gameStore.timeRemaining <= 0" className="text-center py-12 space-y-3 border-amber-500/40">
        <div class="text-4xl">⏱️</div>
        <h3 class="text-xl font-black text-amber-200">Time's Up!</h3>
        <p class="text-xs text-slate-300">Waiting for question results...</p>
      </GlassCard>

      <div v-else class="grid grid-cols-2 gap-3 min-h-[300px]">
        <button
          v-for="(opt, idx) in gameStore.currentQuestion?.options"
          :key="opt.id"
          @click="gameStore.submitAnswer(opt.id)"
          :class="[
            'p-5 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shadow-lg select-none',
            optionStyles[idx % optionStyles.length],
          ]"
        >
          <span class="text-3xl font-black">{{ optionSymbols[idx % optionSymbols.length] }}</span>
          <span class="font-semibold text-sm sm:text-base text-center leading-tight line-clamp-3">
            {{ opt.content }}
          </span>
        </button>
      </div>
    </div>

    <!-- 4. QUESTION RESULT FEEDBACK -->
    <GlassCard v-else-if="gameStore.gameState === 'result'" className="text-center py-10 space-y-4">
      <div v-if="gameStore.answerResult?.isCorrect" class="space-y-3">
        <div class="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-3xl shadow-[0_0_25px_rgba(16,185,129,0.5)]">
          ✓
        </div>
        <h2 class="text-2xl font-black text-emerald-300">Correct!</h2>
        <div class="text-3xl font-extrabold text-white">
          +{{ gameStore.answerResult.points }} pts
        </div>
        <div v-if="(gameStore.answerResult.streak || 0) > 1" class="text-xs font-bold text-amber-300">
          🔥 {{ gameStore.answerResult.streak }} Answer Streak
        </div>
      </div>

      <div v-else-if="gameStore.answerResult?.timedOut || !gameStore.answerResult" class="space-y-3">
        <div class="w-16 h-16 mx-auto rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center text-3xl">
          ⏱️
        </div>
        <h2 class="text-2xl font-black text-amber-300">Time's Up!</h2>
        <div class="text-sm text-slate-300">No answer submitted before the timer ended</div>
      </div>

      <div v-else class="space-y-3">
        <div class="w-16 h-16 mx-auto rounded-full bg-rose-500/20 border-2 border-rose-400 flex items-center justify-center text-3xl shadow-[0_0_25px_rgba(244,63,94,0.5)]">
          ✕
        </div>
        <h2 class="text-2xl font-black text-rose-300">Incorrect</h2>
        <div class="text-sm text-slate-300">No points awarded this round</div>
      </div>

      <div class="pt-4 border-t border-white/10 space-y-2 text-sm">
        <div class="flex justify-between items-center">
          <span class="text-slate-400">Total Score:</span>
          <span class="font-black text-lg text-purple-300">{{ gameStore.playerScore.toLocaleString() }} pts</span>
        </div>
        <div v-if="gameStore.playerRank" class="flex justify-between items-center">
          <span class="text-slate-400">Current Rank:</span>
          <span class="font-bold text-white">#{{ gameStore.playerRank }}</span>
        </div>
      </div>
    </GlassCard>

    <!-- 5. FINAL PODIUM / GAME OVER -->
    <GlassCard v-else-if="gameStore.gameState === 'podium'" className="text-center py-10 space-y-6">
      <div class="text-4xl">🎉</div>
      <h2 class="text-2xl font-extrabold text-white">Game Over!</h2>
      <p class="text-sm text-slate-300">Great effort! Check the big screen for the final podium winners.</p>

      <div class="p-6 rounded-2xl bg-white/10 border border-white/20 space-y-2">
        <div class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Your Final Score</div>
        <div class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300">
          {{ gameStore.playerScore.toLocaleString() }}
        </div>
        <div v-if="gameStore.finalRank" class="text-sm font-bold text-amber-300 pt-1">
          Final Rank: #{{ gameStore.finalRank }}
          <span v-if="gameStore.finalTotalPlayers" class="text-slate-400 font-normal">
            of {{ gameStore.finalTotalPlayers }}
          </span>
        </div>
      </div>

      <GlassButton variant="secondary" className="w-full" @click="gameStore.resetGame()">
        Play Another Game
      </GlassButton>
    </GlassCard>
  </div>
</template>
