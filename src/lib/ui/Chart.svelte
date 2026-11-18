<script lang="ts">
  import {
    ArcElement,
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    DoughnutController,
    Legend,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Tooltip,
    type ChartConfiguration,
  } from 'chart.js';
  import { session } from '../state/session.svelte';

  Chart.register(
    ArcElement,
    BarController,
    BarElement,
    CategoryScale,
    DoughnutController,
    Legend,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Tooltip,
  );

  interface Props {
    config: ChartConfiguration;
    label: string;
    height?: number;
  }
  let { config, label, height = 240 }: Props = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  let wrapper: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!canvas) return;
    void session.theme; // bei Theme-Wechsel neu zeichnen
    const styles = getComputedStyle(document.documentElement);
    Chart.defaults.color = styles.getPropertyValue('--muted').trim();
    Chart.defaults.borderColor = styles.getPropertyValue('--border').trim();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const chart = new Chart(canvas, {
      ...config,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        ...config.options,
      },
    });
    return () => chart.destroy();
  });

  $effect(() => {
    if (wrapper) wrapper.style.height = `${height}px`;
  });
</script>

<div bind:this={wrapper} class="chart" role="img" aria-label={label}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }
</style>
