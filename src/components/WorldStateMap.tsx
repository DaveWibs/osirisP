'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface WorldStateMapEvent {
  id: string;
  category: string;
  eventType: string;
  title: string;
  provider: string;
  severity: string | null;
  occurredAt: string;
  point: { lat: number; lon: number };
}

interface WorldStateMapProps {
  events: WorldStateMapEvent[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const CATEGORY_COLORS: Record<string, string> = {
  seismic: '#ff9500',
  disaster: '#ff3d3d',
  fire: '#ff6b00',
  weather: '#e040fb',
  air_quality: '#00e676',
  internet_outage: '#448aff',
  aviation: '#00e5ff',
};

export default function WorldStateMap({ events, selectedEventId, onSelectEvent }: WorldStateMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onSelectRef = useRef(onSelectEvent);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelectEvent;
  }, [onSelectEvent]);

  const featureCollection = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: events.map((event): GeoJSON.Feature => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [event.point.lon, event.point.lat],
      },
      properties: {
        id: event.id,
        category: event.category,
        eventType: event.eventType,
        title: event.title,
        provider: event.provider,
        severity: event.severity ?? 'unscored',
        occurredAt: event.occurredAt,
        selected: event.id === selectedEventId,
        color: CATEGORY_COLORS[event.category] ?? '#D4AF37',
      },
    })),
  }), [events, selectedEventId]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [20, 20],
      zoom: 1.5,
      minZoom: 1.2,
      maxZoom: 14,
      attributionControl: false,
      transformRequest: (url: string) => {
        if (url.includes('cartocdn.com')) {
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
          return { url: `${baseUrl}/api/proxy-tiles?url=${encodeURIComponent(url)}` };
        }
        return { url };
      },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    map.on('load', () => {
      map.addSource('worldstate-events', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'worldstate-event-halo',
        type: 'circle',
        source: 'worldstate-events',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], true], 22, 14],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['==', ['get', 'selected'], true], 0.25, 0.13],
          'circle-blur': 0.8,
        },
      });
      map.addLayer({
        id: 'worldstate-event-dot',
        type: 'circle',
        source: 'worldstate-events',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], true], 7, 4],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#f5f0e0',
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2, 0.75],
          'circle-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'worldstate-event-label',
        type: 'symbol',
        source: 'worldstate-events',
        minzoom: 3,
        layout: {
          'text-field': ['get', 'category'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 8, 8, 11],
          'text-offset': [0, 1.25],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#04040A',
          'text-halo-width': 1.5,
        },
      });

      map.on('mouseenter', 'worldstate-event-dot', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'worldstate-event-dot', () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('click', 'worldstate-event-dot', (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id !== 'string') return;
        onSelectRef.current(id);
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource('worldstate-events') as maplibregl.GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData(featureCollection);
  }, [featureCollection, mapReady]);

  useEffect(() => {
    if (!mapReady || events.length === 0 || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const event of events.slice(0, 300)) {
      bounds.extend([event.point.lon, event.point.lat]);
    }
    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, { padding: 56, maxZoom: 5, duration: 650 });
    }
  }, [events, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !selectedEventId) return;
    const event = events.find((candidate) => candidate.id === selectedEventId);
    if (!event) return;
    map.easeTo({ center: [event.point.lon, event.point.lat], zoom: Math.max(map.getZoom(), 4), duration: 500 });
    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 14, maxWidth: '320px' })
      .setLngLat([event.point.lon, event.point.lat])
      .setHTML(renderPopup(event))
      .addTo(map);
  }, [events, selectedEventId, mapReady]);

  return (
    <div style={{ position: 'relative', minHeight: 520, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(212,175,55,0.16)' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '8px 10px',
        borderRadius: 10,
        background: 'rgba(4,4,10,0.78)',
        border: '1px solid rgba(212,175,55,0.18)',
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontFamily: 'var(--font-hud)',
      }}>
        {events.length.toLocaleString()} persisted geospatial rows
      </div>
    </div>
  );
}

function renderPopup(event: WorldStateMapEvent): string {
  const color = CATEGORY_COLORS[event.category] ?? '#D4AF37';
  return `
    <div style="background:rgba(4,4,10,0.94);border:1px solid rgba(212,175,55,0.22);border-radius:12px;padding:12px;color:#E8E6E0;font-family:Inter,sans-serif;">
      <div style="font-family:monospace;text-transform:uppercase;letter-spacing:.12em;font-size:10px;color:${color};">${escapeHtml(event.category)} · ${escapeHtml(event.severity ?? 'unscored')}</div>
      <div style="font-weight:700;margin-top:6px;font-size:14px;">${escapeHtml(event.title)}</div>
      <div style="color:#9B978E;font-size:12px;margin-top:5px;">${escapeHtml(event.provider)} · ${escapeHtml(new Date(event.occurredAt).toLocaleString())}</div>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
