import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../dashboard/DashboardView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
      // A join link shared before the games had their own routes looks like
      // `/?room=ABC123` — send it to the room flow rather than dropping it.
      beforeEnter: (to) =>
        to.query.room ? { path: '/quiz', query: { room: to.query.room } } : true,
    },
    // games load on demand so the dashboard stays a small first paint
    { path: '/hanoi', name: 'hanoi', component: () => import('../games/hanoi/HanoiFlow.vue') },
    { path: '/quiz', name: 'quiz', component: () => import('../games/quiz/QuizFlow.vue') },
    {
      path: '/join/:code',
      name: 'join',
      redirect: (to) => ({
        path: '/quiz',
        query: { room: String(to.params.code ?? '').toUpperCase() },
      }),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
