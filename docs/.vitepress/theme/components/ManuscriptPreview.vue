<script setup lang="ts">
import { withBase } from 'vitepress'

const manuscriptPages = [
  {
    page: '01',
    title: 'Title and abstract',
    src: '/assets/manuscript-preview/manuscript-page-01.webp',
  },
  {
    page: '02',
    title: 'Data and sample selection',
    src: '/assets/manuscript-preview/manuscript-page-02.webp',
  },
  {
    page: '03',
    title: 'Rotation curves and mass model',
    src: '/assets/manuscript-preview/manuscript-page-03.webp',
  },
]
</script>

<template>
  <section class="manuscript-preview" aria-labelledby="manuscript-preview-title">
    <div class="manuscript-preview__heading">
      <div>
        <p class="section-kicker">Research paper · draft</p>
        <h2 id="manuscript-preview-title">A concise preview of the research paper</h2>
      </div>
      <p class="manuscript-preview__notice">
        Protected research content. Read and cite with attribution; do not reproduce, adapt, submit, or publish it
        without written permission. See the
        <a :href="withBase('/research-content-license.html')">Research Content License</a>.
      </p>
    </div>
    <div class="manuscript-preview__grid">
      <figure v-for="item in manuscriptPages" :key="item.page" class="manuscript-preview__card">
        <a :href="withBase('/paper-preview/')" :aria-label="`Open research paper preview: page ${item.page}`">
          <img :src="withBase(item.src)" :alt="`Draft research paper page ${item.page}: ${item.title}.`" loading="lazy">
        </a>
        <figcaption><span>Page {{ item.page }}</span>{{ item.title }} · © 2026 Hongyi Xu</figcaption>
      </figure>
    </div>
    <a class="home-button home-button--brand" :href="withBase('/paper-preview/')">Open research paper</a>
  </section>
</template>
