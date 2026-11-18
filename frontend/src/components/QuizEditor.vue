<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch } from '../config/env';
import type { Quiz } from '../types/quiz';
import { useAuthStore } from '../stores/authStore';
import { useGameStore } from '../stores/gameStore';
import GlassCard from './ui/GlassCard.vue';
import GlassButton from './ui/GlassButton.vue';
import GlassInput from './ui/GlassInput.vue';

interface EditableOption {
  content: string;
  isCorrect: boolean;
}

interface EditableQuestion {
  prompt: string;
  questionType: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  timeLimitSeconds: number;
  points: number;
  mediaUrl: string;
  options: EditableOption[];
}

const gameStore = useGameStore();
const authStore = useAuthStore();

const quizzes = ref<Quiz[]>([]);
const isLoading = ref(true);
const loadError = ref<string | null>(null);

// Auth modal state
const showAuthModal = ref(false);
const authMode = ref<'login' | 'register'>('login');
const authEmail = ref('');
const authPassword = ref('');
const authDisplayName = ref('');

// Quiz editor modal state
const showCreateModal = ref(false);
const editingQuizId = ref<string | null>(null);
const editorError = ref<string | null>(null);
const isSaving = ref(false);

const newTitle = ref('');
const newDescription = ref('');
const newCoverImageUrl = ref('');
const newIsPublic = ref(true);
const newQuestions = ref<EditableQuestion[]>([createBlankQuestion()]);

function createBlankQuestion(): EditableQuestion {
  return {
    prompt: '',
    questionType: 'MULTIPLE_CHOICE',
    timeLimitSeconds: 20,
    points: 1000,
    mediaUrl: '',
    options: [
      { content: '', isCorrect: true },
      { content: '', isCorrect: false },
      { content: '', isCorrect: false },
      { content: '', isCorrect: false },
    ],
  };
}

function resetEditorForm() {
  editingQuizId.value = null;
  editorError.value = null;
  newTitle.value = '';
  newDescription.value = '';
  newCoverImageUrl.value = '';
  newIsPublic.value = true;
  newQuestions.value = [createBlankQuestion()];
}

async function fetchQuizzes() {
  isLoading.value = true;
  loadError.value = null;
  try {
    quizzes.value = await apiFetch<Quiz[]>('/quizzes', {}, authStore.token);
  } catch (err: unknown) {
    loadError.value = err instanceof Error ? err.message : 'Failed to load quizzes.';
  } finally {
    isLoading.value = false;
  }
}

function handleHostQuiz(quizId: string) {
  gameStore.createRoom(quizId, authStore.token);
}

function openCreateForm() {
  if (!authStore.isAuthenticated) {
    showAuthModal.value = true;
    return;
  }
  resetEditorForm();
  showCreateModal.value = true;
}

async function openEditForm(quizId: string) {
  if (!authStore.isAuthenticated) {
    showAuthModal.value = true;
    return;
  }
  editorError.value = null;
  try {
    const full = await apiFetch<Quiz>(`/quizzes/${quizId}/manage`, {}, authStore.token);
    editingQuizId.value = full.id;
    newTitle.value = full.title;
    newDescription.value = full.description || '';
    newCoverImageUrl.value = full.coverImageUrl || '';
    newIsPublic.value = full.isPublic !== false;
    newQuestions.value = full.questions.map((q) => ({
      prompt: q.prompt,
      questionType: q.questionType === 'TRUE_FALSE' ? 'TRUE_FALSE' : 'MULTIPLE_CHOICE',
      timeLimitSeconds: q.timeLimitSeconds || 20,
      points: q.points || 1000,
      mediaUrl: q.mediaUrl || '',
      options: q.options.map((opt) => ({
        content: opt.content,
        isCorrect: Boolean(opt.isCorrect),
      })),
    }));
    showCreateModal.value = true;
  } catch (err: unknown) {
    loadError.value = err instanceof Error ? err.message : 'Failed to load quiz for editing.';
  }
}

async function deleteQuiz(quizId: string) {
  if (!authStore.isAuthenticated) {
    showAuthModal.value = true;
    return;
  }
  if (!window.confirm('Delete this quiz permanently?')) return;

  try {
    await apiFetch(`/quizzes/${quizId}`, { method: 'DELETE' }, authStore.token);
    await fetchQuizzes();
  } catch (err: unknown) {
    loadError.value = err instanceof Error ? err.message : 'Failed to delete quiz.';
  }
}

function addQuestion() {
  newQuestions.value.push(createBlankQuestion());
}

function removeQuestion(index: number) {
  if (newQuestions.value.length > 1) {
    newQuestions.value.splice(index, 1);
  }
}

function addOption(qIndex: number) {
  const options = newQuestions.value[qIndex].options;
  if (options.length < 6) {
    options.push({ content: '', isCorrect: false });
  }
}

function removeOption(qIndex: number, oIndex: number) {
  const options = newQuestions.value[qIndex].options;
  if (options.length > 2) {
    options.splice(oIndex, 1);
    if (!options.some((o) => o.isCorrect)) {
      options[0].isCorrect = true;
    }
  }
}

function setQuestionType(qIndex: number, type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE') {
  const q = newQuestions.value[qIndex];
  q.questionType = type;
  if (type === 'TRUE_FALSE') {
    q.options = [
      { content: 'True', isCorrect: true },
      { content: 'False', isCorrect: false },
    ];
  } else if (q.options.length < 4) {
    while (q.options.length < 4) {
      q.options.push({ content: '', isCorrect: false });
    }
  }
}

function validateForm(): string | null {
  if (!newTitle.value.trim()) return 'Quiz title is required.';
  for (let i = 0; i < newQuestions.value.length; i++) {
    const q = newQuestions.value[i];
    if (!q.prompt.trim()) return `Question ${i + 1} prompt cannot be empty.`;
    if (q.options.length < 2) return `Question ${i + 1} needs at least 2 options.`;
    if (q.options.some((o) => !o.content.trim())) {
      return `Question ${i + 1} has an empty option.`;
    }
    if (!q.options.some((o) => o.isCorrect)) {
      return `Question ${i + 1} needs at least one correct answer.`;
    }
  }
  return null;
}

async function saveQuiz() {
  const validationErr = validateForm();
  if (validationErr) {
    editorError.value = validationErr;
    return;
  }

  editorError.value = null;
  isSaving.value = true;

  const payload = {
    title: newTitle.value.trim(),
    description: newDescription.value.trim(),
    coverImageUrl: newCoverImageUrl.value.trim() || undefined,
    isPublic: newIsPublic.value,
    questions: newQuestions.value.map((q) => ({
      prompt: q.prompt.trim(),
      questionType: q.questionType,
      timeLimitSeconds: Number(q.timeLimitSeconds) || 20,
      points: Number(q.points) || 1000,
      mediaUrl: q.mediaUrl.trim() || undefined,
      options: q.options.map((opt) => ({
        content: opt.content.trim(),
        isCorrect: opt.isCorrect,
      })),
    })),
  };

  try {
    if (editingQuizId.value) {
      await apiFetch(
        `/quizzes/${editingQuizId.value}`,
        { method: 'PUT', body: JSON.stringify(payload) },
        authStore.token,
      );
    } else {
      await apiFetch(
        '/quizzes',
        { method: 'POST', body: JSON.stringify(payload) },
        authStore.token,
      );
    }
    showCreateModal.value = false;
    resetEditorForm();
    await fetchQuizzes();
  } catch (err: unknown) {
    editorError.value = err instanceof Error ? err.message : 'Failed to save quiz.';
  } finally {
    isSaving.value = false;
  }
}

async function submitAuth() {
  let ok = false;
  if (authMode.value === 'login') {
    ok = await authStore.login(authEmail.value, authPassword.value);
  } else {
    ok = await authStore.register(
      authEmail.value,
      authPassword.value,
      authDisplayName.value,
    );
  }

  if (ok) {
    showAuthModal.value = false;
    authPassword.value = '';
    await fetchQuizzes();
  }
}

function canManageQuiz(quiz: Quiz): boolean {
  return Boolean(
    authStore.user && quiz.creatorId && quiz.creatorId === authStore.user.id,
  );
}

onMounted(() => {
  fetchQuizzes();
});
</script>

<template>
  <div class="space-y-8">
    <!-- Header with Create & Host Auth Controls -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-3xl font-black text-white">Quiz Library</h1>
        <p class="text-slate-400 text-sm mt-1">
          Select any public quiz to host live, or sign in as a host to create & manage quizzes.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <GlassButton
          v-if="!authStore.isAuthenticated"
          variant="secondary"
          size="md"
          @click="showAuthModal = true"
        >
          🔑 Host Sign In
        </GlassButton>
        <GlassButton
          variant="primary"
          @click="showCreateModal ? (showCreateModal = false) : openCreateForm()"
        >
          {{ showCreateModal ? '✕ Close Form' : '+ Create New Quiz' }}
        </GlassButton>
      </div>
    </div>

    <!-- Host Auth Modal -->
    <GlassCard v-if="showAuthModal" className="max-w-md mx-auto space-y-5 border-indigo-400/40">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-white">
          {{ authMode === 'login' ? 'Host Sign In' : 'Create Host Account' }}
        </h2>
        <button @click="showAuthModal = false" class="text-slate-400 hover:text-white cursor-pointer">
          ✕
        </button>
      </div>

      <form class="space-y-4" @submit.prevent="submitAuth">
        <div v-if="authMode === 'register'">
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Display Name</label>
          <GlassInput v-model="authDisplayName" placeholder="e.g. Prof. Alex" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Email</label>
          <GlassInput v-model="authEmail" type="email" placeholder="host@example.com" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Password (min 8 chars)</label>
          <GlassInput v-model="authPassword" type="password" placeholder="••••••••" />
        </div>

        <div
          v-if="authStore.authError"
          role="alert"
          class="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-sm"
        >
          {{ authStore.authError }}
        </div>

        <GlassButton type="submit" variant="primary" className="w-full" :disabled="authStore.isLoading">
          {{ authStore.isLoading ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Register & Sign In' }}
        </GlassButton>
      </form>

      <div class="text-center text-xs text-slate-400">
        <button
          @click="authMode = authMode === 'login' ? 'register' : 'login'"
          class="text-purple-300 hover:underline cursor-pointer"
        >
          {{ authMode === 'login' ? 'Need an account? Register here' : 'Already have an account? Sign in' }}
        </button>
      </div>
    </GlassCard>

    <!-- Create / Edit Quiz Form -->
    <GlassCard v-if="showCreateModal" className="space-y-6 border-purple-500/40">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-white">
          {{ editingQuizId ? 'Edit Quiz' : 'Create New Quiz' }}
        </h2>
        <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" v-model="newIsPublic" class="accent-purple-500 w-4 h-4" />
          <span>Public in Library</span>
        </label>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Quiz Title</label>
          <GlassInput v-model="newTitle" placeholder="e.g. JavaScript & Vue Essentials" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Cover Image URL (Optional)</label>
          <GlassInput v-model="newCoverImageUrl" placeholder="https://..." />
        </div>

        <div class="md:col-span-2">
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Description</label>
          <GlassInput v-model="newDescription" placeholder="Short description for participants..." />
        </div>
      </div>

      <!-- Question List -->
      <div class="space-y-6 pt-4 border-t border-white/10">
        <h3 class="text-lg font-bold text-purple-300">Questions ({{ newQuestions.length }})</h3>

        <div
          v-for="(q, qIndex) in newQuestions"
          :key="qIndex"
          class="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-bold text-sm text-slate-300">Question {{ qIndex + 1 }}</span>

            <div class="flex flex-wrap items-center gap-2 text-xs">
              <select
                :value="q.questionType"
                @change="setQuestionType(qIndex, ($event.target as HTMLSelectElement).value as 'MULTIPLE_CHOICE' | 'TRUE_FALSE')"
                class="bg-slate-900/90 border border-white/15 rounded-lg px-2.5 py-1 text-slate-200 outline-none"
              >
                <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                <option value="TRUE_FALSE">True / False</option>
              </select>

              <select
                v-model.number="q.timeLimitSeconds"
                class="bg-slate-900/90 border border-white/15 rounded-lg px-2.5 py-1 text-slate-200 outline-none"
              >
                <option :value="10">10s</option>
                <option :value="15">15s</option>
                <option :value="20">20s</option>
                <option :value="30">30s</option>
                <option :value="45">45s</option>
                <option :value="60">60s</option>
              </select>

              <select
                v-model.number="q.points"
                class="bg-slate-900/90 border border-white/15 rounded-lg px-2.5 py-1 text-slate-200 outline-none"
              >
                <option :value="500">500 pts</option>
                <option :value="1000">1000 pts</option>
                <option :value="2000">2000 pts</option>
              </select>

              <button
                v-if="newQuestions.length > 1"
                @click="removeQuestion(qIndex)"
                class="text-rose-400 hover:text-rose-300 cursor-pointer ml-2"
              >
                Remove
              </button>
            </div>
          </div>

          <GlassInput v-model="q.prompt" placeholder="Question prompt (e.g. What does API stand for?)" />

          <GlassInput v-model="q.mediaUrl" placeholder="Optional image URL (https://...)" className="text-sm py-2" />

          <!-- Options -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div
              v-for="(opt, oIndex) in q.options"
              :key="oIndex"
              class="flex items-center gap-2 p-2.5 rounded-xl bg-black/20 border border-white/10"
            >
              <input
                type="checkbox"
                v-model="opt.isCorrect"
                class="accent-emerald-500 cursor-pointer w-4 h-4 shrink-0"
                title="Mark as correct answer"
              />
              <input
                v-model="opt.content"
                :placeholder="`Option ${String.fromCharCode(65 + oIndex)}`"
                class="bg-transparent text-sm w-full outline-none text-white placeholder:text-slate-500"
              />
              <button
                v-if="q.options.length > 2"
                @click="removeOption(qIndex, oIndex)"
                class="text-xs text-slate-400 hover:text-rose-400 cursor-pointer"
                title="Remove option"
              >
                ✕
              </button>
            </div>
          </div>

          <div v-if="q.questionType === 'MULTIPLE_CHOICE' && q.options.length < 6" class="pt-1">
            <button
              @click="addOption(qIndex)"
              class="text-xs text-purple-300 hover:text-purple-200 cursor-pointer"
            >
              + Add Option
            </button>
          </div>
        </div>

        <div
          v-if="editorError"
          role="alert"
          class="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-sm"
        >
          {{ editorError }}
        </div>

        <div class="flex flex-wrap justify-between items-center gap-3 pt-2">
          <GlassButton variant="secondary" size="sm" @click="addQuestion">
            + Add Another Question
          </GlassButton>

          <div class="flex items-center gap-2">
            <GlassButton
              variant="ghost"
              size="md"
              @click="showCreateModal = false; resetEditorForm()"
            >
              Cancel
            </GlassButton>
            <GlassButton variant="primary" size="md" :disabled="isSaving" @click="saveQuiz">
              {{ isSaving ? 'Saving...' : editingQuizId ? '💾 Update Quiz' : '💾 Save Quiz' }}
            </GlassButton>
          </div>
        </div>
      </div>
    </GlassCard>

    <!-- Load error notice -->
    <div
      v-if="loadError"
      role="alert"
      class="p-4 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-sm flex justify-between items-center"
    >
      <span>{{ loadError }}</span>
      <GlassButton variant="ghost" size="sm" @click="fetchQuizzes">Retry</GlassButton>
    </div>

    <!-- Quiz Grid -->
    <div v-if="isLoading" class="py-12 text-center text-slate-400">
      Loading quizzes...
    </div>

    <div v-else-if="quizzes.length === 0" class="py-12 text-center text-slate-400">
      No quizzes found yet. Sign in and create your first quiz!
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <GlassCard
        v-for="quiz in quizzes"
        :key="quiz.id"
        :interactive="true"
        className="flex flex-col justify-between"
      >
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
              {{ quiz.questions.length }} Questions
            </span>
            <div class="flex items-center gap-2">
              <span
                v-if="quiz.isPublic === false"
                class="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30"
              >
                Private
              </span>
              <span v-if="quiz.creatorName" class="text-xs text-slate-400">
                by {{ quiz.creatorName }}
              </span>
            </div>
          </div>
          <h3 class="text-xl font-bold text-white">{{ quiz.title }}</h3>
          <p class="text-sm text-slate-300 line-clamp-2">{{ quiz.description }}</p>
        </div>

        <div class="mt-6 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <GlassButton
              v-if="canManageQuiz(quiz)"
              variant="secondary"
              size="sm"
              @click="openEditForm(quiz.id)"
            >
              ✏️ Edit
            </GlassButton>
            <GlassButton
              v-if="canManageQuiz(quiz)"
              variant="danger"
              size="sm"
              @click="deleteQuiz(quiz.id)"
            >
              Delete
            </GlassButton>
            <span v-if="!canManageQuiz(quiz)" class="text-xs text-slate-400">Ready to play</span>
          </div>

          <GlassButton variant="primary" size="sm" @click="handleHostQuiz(quiz.id)">
            Host Live Game 🚀
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  </div>
</template>
