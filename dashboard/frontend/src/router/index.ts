import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: LoginView },
    {
      path: '/dashboard',
      component: DashboardView,
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true
  try {
    const res = await fetch('/api/containers', { credentials: 'include' })
    if (res.status === 401) return '/'
  } catch {
    return '/'
  }
  return true
})
