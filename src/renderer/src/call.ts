import { mount } from 'svelte'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './app.css'
import CallOverlay from './CallOverlay.svelte'

const app = mount(CallOverlay, {
  target: document.getElementById('app')!,
})

export default app
