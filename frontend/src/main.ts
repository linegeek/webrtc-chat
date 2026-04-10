import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import { definePreset } from '@primevue/themes'
import 'primeicons/primeicons.css'
import 'primeflex/primeflex.css'
import App from './App.vue'

import './style.css'

// Override Aura's default emerald primary with Sky.
// Every PrimeVue component (Button, Tag, ProgressBar, …) and the
// --p-primary-* CSS variables all derive from this single palette swap.
const SkyAura = definePreset(Aura, {
  semantic: {
    primary: {
      50:  '{sky.50}',
      100: '{sky.100}',
      200: '{sky.200}',
      300: '{sky.300}',
      400: '{sky.400}',
      500: '{sky.500}',
      600: '{sky.600}',
      700: '{sky.700}',
      800: '{sky.800}',
      900: '{sky.900}',
      950: '{sky.950}',
    },
  },
})

const app = createApp(App)

app.use(PrimeVue, {
  theme: {
    preset: SkyAura,
    options: {
      darkModeSelector: '.app-dark',
    },
  },
})

app.mount('#app')
