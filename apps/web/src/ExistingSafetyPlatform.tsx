import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getRouteCoordinates, geocodeAddress, replaceMapLayers, type Coordinates } from './mapRouting';
import { isMapPanelVisible, scheduleMapResize, type MapTab } from './mapLifecycle';
import { 
  Shield, ShieldAlert, ShieldCheck, AlertTriangle, Phone, 
  MapPin, Clock, Battery, Send, Navigation, Volume2, 
  VolumeX, Share2, Eye, UserCheck, Bell, CheckCircle2, 
  Car, Footprints, Bus, ChevronRight, AlertOctagon, Sparkles, 
  Copy, Check, ArrowRight, ArrowLeft, RefreshCw, X, ChevronUp,
  Wifi, Signal, Compass, Building, HeartPulse, Radio, ExternalLink,
  Sliders, Plus, User, ArrowUpRight
} from 'lucide-react';

// --- Gentle Synthetic Sound Engine (Web Audio API) ---
class SoundEngine {
  private ctx: AudioContext | null = null;

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  playChime() {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.22); // A5
      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.45);
    } catch (e) {
      console.warn('Audio chime muted/blocked', e);
    }
  }
  playAlarm() {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(784, this.ctx.currentTime);
      osc.frequency.setValueAtTime(523.25, this.ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.4);
    } catch (e) {
      console.warn('Audio warning muted/blocked', e);
    }
  }
}

const audioFX = new SoundEngine();

type EventLog = { time: string; text: string; status: 'info' | 'warning' | 'safe' | 'danger' };
type TrustedContact = { id: string; name: string; email: string; phone?: string | null };
type ApiJourney = {
  id: string;
  origin: string;
  destination: string;
  mode: string;
  vehicleDetails?: string | null;
  status: string;
  expectedArrival: string;
  nextCheckInAt: string;
  startedAt: string;
  checkInMinutes: number;
  graceMinutes: number;
  locationSharing: boolean;
  demo: boolean;
  locations: { latitude: number; longitude: number; recordedAt: string }[];
  events: { type: string; details?: string | null; createdAt: string; simulated: boolean }[];
  trustedContacts?: { trustedContact: TrustedContact }[];
};

const API = (import.meta.env.VITE_API_URL || (import.meta.env.PROD
  ? 'https://safestride-api.onrender.com'
  : 'http://localhost:4000')).replace(/\/+$/, '');

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers }
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'The request could not be completed.');
  return result as T;
}

function toEventLogs(events: ApiJourney['events']): EventLog[] {
  return events.map((item) => {
    const status: EventLog['status'] = item.type.includes('SOS') || item.type.includes('ESCALAT')
      ? 'danger'
      : item.type.includes('CHECK')
        ? 'warning'
        : 'info';
    return {
      time: new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: item.details ?? item.type.replaceAll('_', ' ').toLowerCase(),
      status
    };
  });
}

const SAFE_HAVENS = [
  { id: 1, name: 'Metro Police Outpost & Women Help Desk', lat: 12.9440, lng: 77.6310, type: 'police', dist: '350m' },
  { id: 2, name: 'City Hospital 24/7 Emergency Care', lat: 12.9610, lng: 77.6440, type: 'hospital', dist: '500m' },
  { id: 3, name: 'All-Night Fuel Station & Well-lit Mart', lat: 12.9680, lng: 77.6530, type: 'safezone', dist: '750m' },
];

// Example journeys available when a user chooses to apply a preset.
const PRESETS = [
  {
    name: 'Late Night Cab',
    origin: 'Office Tech Park, Gate 2',
    destination: 'Green Glen Layout, Flat 402',
    transit: 'cab',
    plate: 'KA 03 AA 8921 • Silver Sedan',
    tripMins: 25,
    checkInMins: 7,
    guardian: 'Mom (Radha)',
    phone: '+91 98765 43210'
  },
  {
    name: 'Metro Walk Home',
    origin: 'MG Road Metro Station',
    destination: 'University Girls Hostel, Gate 1',
    transit: 'walk',
    plate: 'Walking alone on foot (well-lit route)',
    tripMins: 15,
    checkInMins: 5,
    guardian: 'Pooja (Roommate)',
    phone: '+91 98111 22334'
  },
  {
    name: 'Intercity Bus Transit',
    origin: 'Central Bus Terminal',
    destination: 'South Extension Residence',
    transit: 'bus',
    plate: 'Route 201-G • Bus #44',
    tripMins: 45,
    checkInMins: 10,
    guardian: 'Dad (Kishore)',
    phone: '+91 94444 55566'
  }
] as const;

export default function App() {
  // Navigation / View: 'setup' (default first screen) | 'traveler' | 'guardian'
  const [activeTab, setActiveTab] = useState<MapTab>('setup');
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [showDemoTools, setShowDemoTools] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Journey Setup Parameters (User can configure in Setup screen)
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [transitType, setTransitType] = useState<'cab' | 'walk' | 'bus'>('cab');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [tripMinutes, setTripMinutes] = useState(25);
  const [checkInMinutes, setCheckInMinutes] = useState(8);
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [trustedContacts, setTrustedContacts] = useState<TrustedContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [locationSharing, setLocationSharing] = useState(false);
  const [apiJourneyId, setApiJourneyId] = useState<string | null>(null);
  const [apiError, setApiError] = useState('');
  const [realPosition, setRealPosition] = useState<[number, number] | null>(null);
  const [originPosition, setOriginPosition] = useState<Coordinates | null>(null);
  const [destinationPosition, setDestinationPosition] = useState<Coordinates | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinates[]>([]);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [routeError, setRouteError] = useState('');
  const [lastLocationAt, setLastLocationAt] = useState<Date | null>(null);
  const [apiBusy, setApiBusy] = useState(false);

  // Journey Execution State
  // 'idle' | 'running' | 'checkin_due' | 'grace_period' | 'escalated' | 'sos' | 'completed'
  const [journeyState, setJourneyState] = useState('idle');
  const [tripId, setTripId] = useState('STRIDE-8821');
  const [tripSecondsLeft, setTripSecondsLeft] = useState(25 * 60);
  const [checkInSecondsLeft, setCheckInSecondsLeft] = useState(8 * 60);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(60);
  const [progressRatio, setProgressRatio] = useState(0.12);
  const [phoneBattery, setPhoneBattery] = useState<number | null>(null);
  const [travelSpeed, setTravelSpeed] = useState<number | null>(null);
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);

  // Slide to SOS gesture state
  const [sosSlideOffset, setSosSlideOffset] = useState(0);
  const [isDraggingSos, setIsDraggingSos] = useState(false);
  const sosTrackRef = useRef<HTMLDivElement | null>(null);
  const lastLocationSentAt = useRef(0);
  const gpsLocationRevision = useRef(0);

  // Map DOM containers
  const travelerMapRef = useRef<HTMLDivElement | null>(null);
  const guardianMapRef = useRef<HTMLDivElement | null>(null);
  const travelerMapInstance = useRef<L.Map | null>(null);
  const guardianMapInstance = useRef<L.Map | null>(null);
  const travelerMapResizeObserver = useRef<ResizeObserver | null>(null);
  const guardianMapResizeObserver = useRef<ResizeObserver | null>(null);
  const travelerMarkerInstance = useRef<L.Marker | null>(null);
  const guardianMarkerInstance = useRef<L.Marker | null>(null);
  const travelerJourneyLayers = useRef<L.LayerGroup | null>(null);
  const guardianJourneyLayers = useRef<L.LayerGroup | null>(null);
  const travelerDemoLayers = useRef<L.LayerGroup | null>(null);
  const guardianDemoLayers = useRef<L.LayerGroup | null>(null);
  const addressRequestId = useRef(0);
  const [leafletReady, setLeafletReady] = useState(false);

  // Battery detection API
  useEffect(() => {
    const batteryNavigator = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        addEventListener: (event: string, listener: () => void) => void;
        removeEventListener: (event: string, listener: () => void) => void;
      }>;
    };
    let battery: {
      level: number;
      addEventListener: (event: string, listener: () => void) => void;
      removeEventListener: (event: string, listener: () => void) => void;
    } | null = null;
    let mounted = true;
    const updateBattery = () => {
      if (mounted && battery) setPhoneBattery(Math.round(battery.level * 100));
    };
    if (batteryNavigator.getBattery) {
      void batteryNavigator.getBattery().then((result) => {
        if (!mounted) return;
        battery = result;
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
      }).catch(() => {
        if (mounted) setPhoneBattery(null);
      });
    }
    return () => {
      mounted = false;
      battery?.removeEventListener('levelchange', updateBattery);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const [{ contacts }, { journey }] = await Promise.all([
          apiRequest<{ contacts: TrustedContact[] }>('/contacts'),
          apiRequest<{ journey: ApiJourney | null }>('/journeys/active')
        ]);
        if (cancelled) return;
        setTrustedContacts(contacts);
        if (journey) {
          setApiJourneyId(journey.id);
          setOrigin(journey.origin);
          setDestination(journey.destination);
          setVehiclePlate(journey.vehicleDetails ?? '');
          setTransitType(journey.mode === 'walking' ? 'walk' : journey.mode === 'bus/metro' ? 'bus' : 'cab');
          setTripMinutes(Math.max(1, Math.ceil((new Date(journey.expectedArrival).getTime() - Date.now()) / 60000)));
          setCheckInMinutes(journey.checkInMinutes);
          setDemoMode(journey.demo);
          setJourneyState(journey.status.toLowerCase());
          setLocationSharing(journey.locationSharing);
          setSelectedContactIds(journey.trustedContacts?.map(({ trustedContact }) => trustedContact.id) ?? []);
          const remaining = Math.max(0, Math.ceil((new Date(journey.nextCheckInAt).getTime() - Date.now()) / 1000));
          setCheckInSecondsLeft(remaining);
          setGraceSecondsLeft(remaining);
          if (journey.locations[0]) {
            setRealPosition([journey.locations[0].latitude, journey.locations[0].longitude]);
            setLastLocationAt(new Date(journey.locations[0].recordedAt));
          }
          setEventLogs(toEventLogs(journey.events));
          setTripId(journey.id.slice(-8).toUpperCase());
        }
      } catch (error) {
        if (!cancelled) setApiError(error instanceof Error ? error.message : 'Could not load your SafeStride session.');
      }
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const requestId = ++addressRequestId.current;
    const controller = new AbortController();
    setOriginPosition(null);
    setDestinationPosition(null);
    setRouteCoordinates([]);
    setRouteError('');
    if (!origin.trim() || !destination.trim()) {
      setRouteStatus('idle');
      return () => controller.abort();
    }

    setRouteStatus('loading');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const start = await geocodeAddress(origin, controller.signal);
          const end = await geocodeAddress(destination, controller.signal);
          if (controller.signal.aborted || requestId !== addressRequestId.current) return;
          setOriginPosition(start);
          setDestinationPosition(end);
          const route = await getRouteCoordinates(start, end, transitType, controller.signal);
          if (controller.signal.aborted || requestId !== addressRequestId.current) return;
          setRouteCoordinates(route);
          setRouteStatus('ready');
        } catch (reason) {
          if (controller.signal.aborted || requestId !== addressRequestId.current) return;
          setRouteError(reason instanceof Error ? reason.message : 'Could not update the map for these addresses.');
          setRouteStatus('error');
        }
      })();
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [origin, destination, transitType]);

  useEffect(() => {
    if (!apiJourneyId || demoMode) return;
    let cancelled = false;
    const refreshJourney = async () => {
      const locationRevisionAtRequest = gpsLocationRevision.current;
      try {
        const { journey } = await apiRequest<{ journey: ApiJourney }>(`/journeys/${apiJourneyId}`);
        if (cancelled) return;
        setJourneyState(journey.status.toLowerCase());
        setCheckInSecondsLeft(Math.max(0, Math.ceil((new Date(journey.nextCheckInAt).getTime() - Date.now()) / 1000)));
        setGraceSecondsLeft(Math.max(0, Math.ceil((new Date(journey.nextCheckInAt).getTime() - Date.now()) / 1000)));
        setTripSecondsLeft(Math.max(0, Math.ceil((new Date(journey.expectedArrival).getTime() - Date.now()) / 1000)));
        if (journey.locations[0] && locationRevisionAtRequest === gpsLocationRevision.current) {
          setRealPosition([journey.locations[0].latitude, journey.locations[0].longitude]);
          setLastLocationAt(new Date(journey.locations[0].recordedAt));
        }
        setEventLogs(toEventLogs(journey.events));
      } catch (error) {
        if (!cancelled) setApiError(error instanceof Error ? error.message : 'Could not refresh your journey.');
      }
    };
    void refreshJourney();
    const interval = window.setInterval(() => { void refreshJourney(); }, 4000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [apiJourneyId, demoMode]);

  useEffect(() => {
    if (!apiJourneyId || demoMode || !locationSharing) return;
    if (!navigator.geolocation) {
      setApiError('Browser location is unavailable. Your journey and check-ins continue without location.');
      return;
    }
    let cancelled = false;
    let watchId: number;
    const onPosition = ({ coords }: GeolocationPosition) => {
      if (cancelled) return;
      if (Date.now() - lastLocationSentAt.current < 30000) return;
      lastLocationSentAt.current = Date.now();
      gpsLocationRevision.current += 1;
      const point: [number, number] = [coords.latitude, coords.longitude];
      setRealPosition(point);
      setLastLocationAt(new Date());
      setTravelSpeed(coords.speed === null ? null : Math.round(coords.speed * 3.6));
      void apiRequest(`/journeys/${apiJourneyId}/location`, {
        method: 'POST',
        body: JSON.stringify({ latitude: point[0], longitude: point[1] })
      }).catch((error: unknown) => setApiError(error instanceof Error ? error.message : 'Location update failed.'));
    };
    const onError = (reason: GeolocationPositionError) => {
      if (cancelled) return;
      setTravelSpeed(null);
      setApiError(reason.code === reason.PERMISSION_DENIED
        ? 'Location permission was denied. Check-ins still work without location.'
        : 'Browser location could not be obtained. Check-ins still work without location.');
    };
    try {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 12000
      });
    } catch {
      setApiError('Could not access browser location. Check-ins still work without location.');
      return;
    }
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [apiJourneyId, demoMode, locationSharing]);

  // Leaflet is bundled with the frontend, so maps do not depend on a remote script.
  useEffect(() => {
    setLeafletReady(true);
  }, []);

  // Demo position follows the resolved route; browser GPS remains separate.
  const currentPos = useMemo<[number, number] | null>(() => {
    if (!demoMode) return realPosition;
    if (routeCoordinates.length < 2) return null;
    const totalSegments = routeCoordinates.length - 1;
    const scaled = Math.max(0, Math.min(1, progressRatio)) * totalSegments;
    const segIdx = Math.min(Math.floor(scaled), totalSegments - 1);
    const segProgress = scaled - segIdx;

    const p1 = routeCoordinates[segIdx];
    const p2 = routeCoordinates[segIdx + 1];

    const lat = p1[0] + (p2[0] - p1[0]) * segProgress;
    const lng = p1[1] + (p2[1] - p1[1]) * segProgress;
    return [lat, lng];
  }, [demoMode, progressRatio, realPosition, routeCoordinates]);

  const visibleSafeHavens = useMemo(() => {
    if (!demoMode || routeCoordinates.length < 2) return [];
    const bounds = L.latLngBounds(routeCoordinates).pad(0.1);
    return SAFE_HAVENS.filter((haven) => bounds.contains([haven.lat, haven.lng]));
  }, [demoMode, routeCoordinates]);

  // Leaflet Map Initialization using FREE Standard OpenStreetMap Tiles (NO API KEY REQUIRED)
  useEffect(() => {
    if (!leafletReady || activeTab === 'setup') return;

    const initMap = (
      containerEl: HTMLDivElement | null,
      mapRef: React.MutableRefObject<L.Map | null>,
      markerRef: React.MutableRefObject<L.Marker | null>,
      journeyLayersRef: React.MutableRefObject<L.LayerGroup | null>,
      demoLayersRef: React.MutableRefObject<L.LayerGroup | null>
    ) => {
      if (!containerEl || mapRef.current) return;

      const initialPosition = currentPos ?? originPosition ?? ([20, 0] as L.LatLngTuple);
      const map = L.map(containerEl, {
        center: initialPosition,
        zoom: currentPos || originPosition ? 14 : 2,
        zoomControl: false,
        attributionControl: true
      });

      // Free standard OpenStreetMap tiles - completely eliminates the CARTO API KEY warning
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      journeyLayersRef.current = L.layerGroup().addTo(map);
      demoLayersRef.current = L.layerGroup().addTo(map);

      mapRef.current = map;
      markerRef.current = null;
    };

    if (activeTab === 'traveler') {
      initMap(travelerMapRef.current, travelerMapInstance, travelerMarkerInstance, travelerJourneyLayers, travelerDemoLayers);
    }
    if (activeTab === 'guardian') {
      initMap(guardianMapRef.current, guardianMapInstance, guardianMarkerInstance, guardianJourneyLayers, guardianDemoLayers);
    }

  }, [leafletReady, activeTab]);

  useEffect(() => {
    const panel = activeTab === 'traveler' || activeTab === 'guardian' ? activeTab : null;
    if (!panel) return;
    const map = panel === 'traveler' ? travelerMapInstance.current : guardianMapInstance.current;
    const container = panel === 'traveler' ? travelerMapRef.current : guardianMapRef.current;
    if (!map || !container) return;

    let cancelResize = () => {};
    const resizeWhenVisible = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      cancelResize();
      cancelResize = scheduleMapResize(map);
    };
    const observer = new ResizeObserver(resizeWhenVisible);
    observer.observe(container);
    if (panel === 'traveler') travelerMapResizeObserver.current = observer;
    else guardianMapResizeObserver.current = observer;
    resizeWhenVisible();

    return () => {
      observer.disconnect();
      cancelResize();
      if (panel === 'traveler') travelerMapResizeObserver.current = null;
      else guardianMapResizeObserver.current = null;
    };
  }, [activeTab, leafletReady]);

  useEffect(() => () => {
    travelerMapResizeObserver.current?.disconnect();
    guardianMapResizeObserver.current?.disconnect();
    travelerMapInstance.current?.remove();
    guardianMapInstance.current?.remove();
    travelerMapInstance.current = null;
    guardianMapInstance.current = null;
    travelerMarkerInstance.current = null;
    guardianMarkerInstance.current = null;
    travelerJourneyLayers.current = null;
    guardianJourneyLayers.current = null;
    travelerDemoLayers.current = null;
    guardianDemoLayers.current = null;
  }, []);

  useEffect(() => {
    const updateMapLayers = (
      map: L.Map | null,
      journeyGroup: L.LayerGroup | null,
      demoGroup: L.LayerGroup | null
    ) => {
      if (!map || !journeyGroup || !demoGroup) return;
      const layers: L.Layer[] = [];
      if (routeCoordinates.length > 1) {
        layers.push(
          L.polyline(routeCoordinates, {
            color: '#0d9488', weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round'
          }),
          L.polyline(routeCoordinates, {
            color: '#2dd4bf', weight: 3, opacity: 0.95, dashArray: '8, 8', lineCap: 'round', lineJoin: 'round'
          })
        );
      }
      if (originPosition) {
        layers.push(L.circleMarker(originPosition, {
          radius: 7, fillColor: '#64748b', fillOpacity: 1, color: '#ffffff', weight: 2
        }).bindTooltip(`Starting address: ${origin}`, { direction: 'top' }));
      }
      if (destinationPosition) {
        layers.push(L.circleMarker(destinationPosition, {
          radius: 8, fillColor: '#10b981', fillOpacity: 1, color: '#ffffff', weight: 2
        }).bindTooltip(`Destination: ${destination}`, { direction: 'top' }));
      }
      replaceMapLayers(journeyGroup, layers);

      const demoLayers = visibleSafeHavens.map((haven) => {
        const color = haven.type === 'police' ? '#3b82f6' : haven.type === 'hospital' ? '#ef4444' : '#10b981';
        const icon = L.divIcon({
          className: 'haven-marker',
          html: `<div style="background:${color}; width:22px; height:22px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.3); font-size:11px; color:white; font-weight:bold;">${haven.type === 'police' ? 'P' : haven.type === 'hospital' ? 'H' : 'S'}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });
        return L.marker([haven.lat, haven.lng], { icon })
          .bindTooltip(`<b>${haven.name}</b><br><span style="color:#64748b">Illustrative demo location • ${haven.dist}</span>`);
      });
      replaceMapLayers(demoGroup, demoLayers);

      const boundsPoints = routeCoordinates.length > 1
        ? routeCoordinates
        : [originPosition, destinationPosition].filter((point): point is Coordinates => point !== null);
      if (boundsPoints.length > 0) map.fitBounds(L.latLngBounds(boundsPoints).pad(0.1), { maxZoom: 14 });
    };

    updateMapLayers(travelerMapInstance.current, travelerJourneyLayers.current, travelerDemoLayers.current);
    updateMapLayers(guardianMapInstance.current, guardianJourneyLayers.current, guardianDemoLayers.current);
  }, [routeCoordinates, originPosition, destinationPosition, origin, destination, visibleSafeHavens, activeTab, leafletReady]);

  useEffect(() => {
    const updatePositionMarker = (
      map: L.Map | null,
      markerRef: React.MutableRefObject<L.Marker | null>,
      color: string
    ) => {
      if (!map) return;
      if (!currentPos) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      const icon = L.divIcon({
        className: 'custom-pulse-marker',
        html: `<div style="position:relative; width:34px; height:34px; display:flex; align-items:center; justify-content:center;"><div style="position:absolute; width:34px; height:34px; border-radius:50%; background:${color}33; animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div><div style="position:absolute; width:22px; height:22px; border-radius:50%; background:${color}; border:3px solid #0f172a; box-shadow:0 0 14px ${color};"></div></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });
      if (!markerRef.current) markerRef.current = L.marker(currentPos, { icon }).addTo(map);
      else markerRef.current.setLatLng(currentPos).setIcon(icon);
      markerRef.current.bindTooltip(demoMode ? 'Simulated position on the resolved route' : 'Browser GPS position', {
        permanent: false, direction: 'bottom'
      });
    };

    updatePositionMarker(travelerMapInstance.current, travelerMarkerInstance, '#14b8a6');
    updatePositionMarker(guardianMapInstance.current, guardianMarkerInstance, '#6366f1');
  }, [currentPos, demoMode, activeTab, leafletReady]);

  // Main safety countdown and escalation engine
  useEffect(() => {
    if (journeyState === 'idle' || journeyState === 'completed') return;

    const ticker = setInterval(() => {
      // Progress simulation along route
      if (demoMode) setProgressRatio(prev => Math.min(0.99, prev + 0.003));

      // Trip ETA countdown
      setTripSecondsLeft(prev => Math.max(0, prev - 1));

      // Running check-in countdown
      if (journeyState === 'running') {
        setCheckInSecondsLeft(prev => {
          if (prev <= 1) {
            if (demoMode) {
              setJourneyState('checkin_due');
              setGraceSecondsLeft(60);
              if (apiJourneyId) void apiRequest(`/demo/${apiJourneyId}/due`, { method: 'POST', body: '{}' })
                .catch((error: unknown) => setApiError(error instanceof Error ? error.message : 'Could not record the demo check-in.'));
              if (!isAudioMuted) audioFX.playChime();
            }
            return 0;
          }
          return prev - 1;
        });
      }

      // Grace period countdown
      if (journeyState === 'checkin_due' || journeyState === 'grace_period') {
        setGraceSecondsLeft(prev => {
          if (prev <= 1) {
            if (demoMode) {
              setJourneyState('escalated');
              const alertMsg = `Demo escalation simulated for ${guardianName}. No SMS was sent.`;
              setEventLogs(l => [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: alertMsg, status: 'danger' }, ...l]);
              if (apiJourneyId) void apiRequest(`/demo/${apiJourneyId}/escalate`, { method: 'POST', body: '{}' })
                .catch((error: unknown) => setApiError(error instanceof Error ? error.message : 'Could not record demo escalation.'));
              if (!isAudioMuted) audioFX.playAlarm();
            }
            return 0;
          }
          if (prev === 15 && !isAudioMuted) audioFX.playAlarm();
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(ticker);
  }, [journeyState, isAudioMuted, guardianName, demoMode, apiJourneyId]);

  // Apply a quick commute preset
  const applyPreset = (preset: typeof PRESETS[number]) => {
    setOrigin(preset.origin);
    setDestination(preset.destination);
    setTransitType(preset.transit);
    setVehiclePlate(preset.plate);
    setTripMinutes(preset.tripMins);
    setCheckInMinutes(preset.checkInMins);
    setGuardianName(preset.guardian);
    setGuardianPhone(preset.phone);
  };

  // Start the Safety Journey
  const addEvent = (text: string, status: EventLog['status']) => {
    setEventLogs((logs) => [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text, status }, ...logs]);
  };

  const handleStartSession = async (forceDemo = demoMode): Promise<string | null> => {
    if (apiJourneyId) return apiJourneyId;
    if (!origin.trim() || !destination.trim()) {
      const message = 'Enter both a starting location and a destination.';
      setRouteError(message);
      setApiError(message);
      return null;
    }
    setApiError('');
    setApiBusy(true);
    try {
      const mode = transitType === 'walk' ? 'walking' : transitType === 'bus' ? 'bus/metro' : 'cab/auto';
      const { journey } = await apiRequest<{ journey: ApiJourney }>('/journeys', {
        method: 'POST',
        body: JSON.stringify({
          origin, destination, mode, vehicleDetails: vehiclePlate,
          expectedArrival: new Date(Date.now() + tripMinutes * 60000).toISOString(),
          checkInMinutes, graceMinutes: 1, contactIds: selectedContactIds,
          locationSharing, demo: forceDemo
        })
      });
      setApiJourneyId(journey.id);
      setTripId(journey.id.slice(-8).toUpperCase());
      setTripSecondsLeft(tripMinutes * 60);
      setCheckInSecondsLeft(checkInMinutes * 60);
      setGraceSecondsLeft(60);
      setProgressRatio(0.08);
      setRealPosition(null);
      setLastLocationAt(null);
      setTravelSpeed(null);
      lastLocationSentAt.current = 0;
      setJourneyState('running');
      setActiveTab('traveler');
      setDemoMode(forceDemo);
      addEvent(`${forceDemo ? 'Demo journey' : 'Journey'} started to ${destination}.`, 'info');
      if (!isAudioMuted) audioFX.playChime();
      return journey.id;
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not start the journey.');
      return null;
    } finally {
      setApiBusy(false);
    }
  };

  const openJourneyView = (tab: 'traveler' | 'guardian') => {
    if (journeyState !== 'idle') {
      setActiveTab(tab);
      return;
    }
    void handleStartSession().then((journeyId) => {
      if (journeyId) setActiveTab(tab);
    });
  };

  const handleDemoAction = async (action: 'due' | 'escalate' | 'sos' | 'arrive') => {
    if (apiJourneyId && !demoMode) {
      setApiError('Simulation actions are only available for a demo journey.');
      return;
    }
    const id = apiJourneyId ?? await handleStartSession(true);
    if (!id) return;
    try {
      const { journey } = await apiRequest<{ journey: ApiJourney }>(`/demo/${id}/${action}`, { method: 'POST', body: '{}' });
      setJourneyState(journey.status.toLowerCase());
      if (action === 'due') setGraceSecondsLeft(60);
      if (action === 'arrive') setProgressRatio(1);
      addEvent(`Demo action: ${action}. No real notification was sent.`, action === 'sos' || action === 'escalate' ? 'danger' : 'warning');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not run the demo action.');
    }
  };

  const handleImSafe = async () => {
    if (!apiJourneyId) return;
    try {
      await apiRequest(`/journeys/${apiJourneyId}/check-in`, { method: 'POST', body: '{}' });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not save the check-in.');
      return;
    }
    setCheckInSecondsLeft(checkInMinutes * 60);
    setGraceSecondsLeft(60);
    setJourneyState('running');
    addEvent(`Traveler checked in. Next check-in in ${checkInMinutes} minutes.`, 'safe');
    if (!isAudioMuted) audioFX.playChime();
  };

  const handleAddDelay = async (mins = 10) => {
    if (!apiJourneyId) return;
    try {
      await apiRequest(`/journeys/${apiJourneyId}/delay`, { method: 'POST', body: JSON.stringify({ delayMinutes: mins }) });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not save the delay.');
      return;
    }
    setTripSecondsLeft(prev => prev + mins * 60);
    setCheckInSecondsLeft(checkInMinutes * 60);
    setGraceSecondsLeft(60);
    setJourneyState('running');
    addEvent(`Traveler reported a ${mins}-minute delay. Arrival time updated.`, 'warning');
    if (!isAudioMuted) audioFX.playChime();
  };

  const handleArrivedSafely = async () => {
    if (!apiJourneyId) return;
    if (demoMode) {
      await handleDemoAction('arrive');
    } else {
      try {
        await apiRequest(`/journeys/${apiJourneyId}/arrive`, { method: 'POST', body: '{}' });
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'Could not complete the journey.');
        return;
      }
    }
    setJourneyState('completed');
    setProgressRatio(1.0);
    addEvent('Journey marked as safely completed.', 'safe');
    if (!isAudioMuted) audioFX.playChime();
  };

  const handleTriggerSos = async () => {
    if (!apiJourneyId) return;
    if (demoMode) {
      await handleDemoAction('sos');
    } else {
      try {
        await apiRequest(`/journeys/${apiJourneyId}/sos`, { method: 'POST', body: '{}' });
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'Could not record SOS.');
        return;
      }
    }
    setJourneyState('sos');
    addEvent(demoMode
      ? 'Demo SOS recorded. No contacts or emergency services were contacted.'
      : 'SOS recorded. Notification delivery is simulated; contact local emergency services if needed.', 'danger');
    if (!isAudioMuted) audioFX.playAlarm();
  };

  const handleResetToSetup = async () => {
    if (apiJourneyId && journeyState !== 'completed' && journeyState !== 'cancelled') {
      try {
        await apiRequest(`/journeys/${apiJourneyId}/cancel`, { method: 'POST', body: '{}' });
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'Could not cancel the journey.');
        return;
      }
    }
    setApiJourneyId(null);
    setJourneyState('idle');
    setActiveTab('setup');
  };

  const copyShareLink = async () => {
    if (!apiJourneyId) return;
    try {
      const { shareUrl } = await apiRequest<{ shareUrl: string }>(`/journeys/${apiJourneyId}/share`, { method: 'POST', body: '{}' });
      await navigator.clipboard?.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not create a private share link.');
    }
  };

  // Slide to SOS gesture handling
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingSos || !sosTrackRef.current) return;
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const rect = sosTrackRef.current.getBoundingClientRect();
    const maxOffset = rect.width - 56;
    const offset = Math.max(0, Math.min(clientX - rect.left - 24, maxOffset));
    setSosSlideOffset(offset);

    if (offset >= maxOffset * 0.9) {
      setIsDraggingSos(false);
      setSosSlideOffset(0);
      handleTriggerSos();
    }
  };

  const handleTouchEnd = () => {
    if (!isDraggingSos) return;
    setIsDraggingSos(false);
    setSosSlideOffset(0);
  };

  const formatMinSec = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-teal-500 selection:text-slate-950">
      
      {/* ==============================================================
          GLOBAL TOP NAVIGATION & CONTROLS (Responsive)
         ============================================================== */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('setup')}>
            <div className="w-9 h-9 rounded-2xl bg-teal-500 flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-teal-500/20">
              <Shield className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-base tracking-tight text-white">SafeStride</span>
                <span className="hidden sm:inline text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                  REIMAGINE EVERYDAY SAFETY
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-none">Journey planning and check-ins</p>
            </div>
          </div>

          {/* Central Mode Switcher */}
          <div className="flex bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
            <button
              onClick={() => setActiveTab('setup')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition ${
                activeTab === 'setup'
                  ? 'bg-slate-800 text-teal-400 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Plan Trip</span>
            </button>

            <button
              onClick={() => openJourneyView('traveler')}
              className={`px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition ${
                activeTab === 'traveler'
                  ? 'bg-teal-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Traveler Map</span>
            </button>
            <button
              onClick={() => openJourneyView('guardian')}
              className={`px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition ${
                activeTab === 'guardian'
                  ? 'bg-indigo-500 text-white shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Guardian View</span>
            </button>
          </div>

          {/* Journey simulation controls */}
          <div className="flex items-center space-x-2">
            <span className={`hidden md:inline-flex items-center px-2 py-1 rounded-full text-[9px] font-bold border ${demoMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
              {demoMode ? 'DEMO MODE' : 'STANDARD MODE'}
            </span>
            <button
              onClick={() => setIsAudioMuted(!isAudioMuted)}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
              title={isAudioMuted ? "Unmute sound alerts" : "Mute audio"}
            >
              {isAudioMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {journeyState !== 'idle' && (
              <button
                onClick={copyShareLink}
                className="hidden sm:flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-teal-400" />}
                <span>{copiedLink ? 'Copied' : 'Share'}</span>
              </button>
            )}

            {/* Journey simulation controls */}
            <button
              onClick={() => setShowDemoTools(!showDemoTools)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border flex items-center space-x-1.5 transition ${
                showDemoTools
                  ? 'bg-teal-400 text-slate-950 border-teal-300'
                  : 'bg-teal-500/10 text-teal-300 border-teal-500/30 hover:bg-teal-500/20'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-300" />
              <span className="hidden sm:inline">Simulation tools</span>
              <span className="sm:hidden">Demo</span>
            </button>
          </div>

        </div>
      </header>
      {apiError && (
        <div role="alert" className="mx-auto mt-3 w-[min(96%,80rem)] rounded-xl border border-rose-500/40 bg-rose-950/70 px-4 py-3 text-xs text-rose-200">
          {apiError}
          <button className="ml-3 font-bold underline" onClick={() => setApiError('')}>Dismiss</button>
        </div>
      )}

      {/* ==============================================================
          JOURNEY SIMULATION CONTROLS
         ============================================================== */}
      {showDemoTools && (
        <div className="bg-slate-900 border-b border-teal-500/40 px-4 py-3 shadow-2xl animate-fadeIn">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-teal-400 animate-pulse" />
              <span className="font-bold text-white">Demo controls:</span>
              <span className="text-slate-400">Simulate check-ins and journey events. No messages are sent.</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  void handleDemoAction('due');
                  setActiveTab('traveler');
                  if (!isAudioMuted) audioFX.playChime();
                }}
                className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-semibold"
              >
                🔔 Prompt Check-in
              </button>
              <button
                onClick={() => {
                  void handleDemoAction('due');
                  setGraceSecondsLeft(10);
                  setActiveTab('traveler');
                }}
                className="px-3 py-1.5 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/40 font-semibold"
              >
                ⏳ 10s Grace Expire
              </button>
              <button
                onClick={() => {
                  void handleDemoAction('escalate');
                  setActiveTab('traveler');
                  if (!isAudioMuted) audioFX.playAlarm();
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 font-semibold"
              >
                🚨 Simulate Escalation
              </button>
              <button
                onClick={() => {
                  void handleDemoAction('sos');
                  setActiveTab('traveler');
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-bold"
              >
                🆘 Simulate SOS
              </button>
              <button
                onClick={() => {
                  void handleDemoAction('arrive');
                  setActiveTab('traveler');
                }}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-semibold"
              >
                ✅ Arrive Safely
              </button>
              <button
                onClick={handleResetToSetup}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-semibold"
              >
                Reset to Setup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          MAIN CONTENT AREA
         ============================================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 lg:p-6 flex flex-col">

        {/* -------------------------------------------------------------
            PAGE 1: SETUP JOURNEY (The Default Landing Page)
           ------------------------------------------------------------- */}
        {activeTab === 'setup' && (
          <div className="max-w-2xl mx-auto w-full space-y-5 animate-fadeIn">
            
            {/* Header / Value Proposition */}
            <div className="text-center space-y-1.5 pt-2">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>Journey check-in support</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Plan a Journey
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto">
                Set a destination and planned arrival time. SafeStride records check-ins against that plan; optional browser location sharing updates your position only while this page is active. No messages are sent to trusted contacts.
              </p>
            </div>

            {/* Quick Presets */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Quick Commute Presets:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="p-3 rounded-2xl bg-slate-900 border border-slate-800 hover:border-teal-500/60 text-left transition active:scale-95 group"
                  >
                    <div className="flex items-center justify-between text-teal-400 font-bold text-xs mb-1">
                      <span>{preset.name}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition" />
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">{preset.destination}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{preset.tripMins} min • check-in every {preset.checkInMins}m</p>
                    <p className="text-[9px] text-amber-300/80 mt-1">Example preset — review all details</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Primary Journey Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
              
              {/* Origin & Destination Inputs */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span>Starting Location</span>
                  </label>
                  <input
                    type="text"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    placeholder="Enter a starting address"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-600 outline-none transition"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
                    <MapPin className="w-3.5 h-3.5 text-teal-400" />
                    <span>Destination</span>
                  </label>
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="Enter a destination"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-600 outline-none transition"
                  />
                </div>
                {routeStatus === 'loading' && <p className="text-[11px] text-slate-400" role="status">Finding these addresses and updating the route…</p>}
                {routeStatus === 'ready' && <p className="text-[11px] text-teal-300" role="status">Address markers and route updated.</p>}
                {routeStatus === 'error' && <p className="text-[11px] text-rose-300" role="alert">{routeError}</p>}
              </div>

              {/* Transit Mode Selection */}
              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                  Transit Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTransitType('cab')}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition ${
                      transitType === 'cab'
                        ? 'bg-teal-500/15 border-teal-500 text-teal-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Car className="w-4 h-4" />
                    <span>Cab / Auto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransitType('walk')}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition ${
                      transitType === 'walk'
                        ? 'bg-teal-500/15 border-teal-500 text-teal-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Footprints className="w-4 h-4" />
                    <span>Walking</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransitType('bus')}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition ${
                      transitType === 'bus'
                        ? 'bg-teal-500/15 border-teal-500 text-teal-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Bus className="w-4 h-4" />
                    <span>Bus / Metro</span>
                  </button>
                </div>
              </div>

              {/* Vehicle / Ride Details */}
              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1 block">
                  Ride Details / License Plate
                </label>
                <input
                  type="text"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  placeholder="e.g. KA 05 MN 9214 • White Dzire"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-600 outline-none transition font-mono"
                />
              </div>

              {/* Durations & Cadence */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Total Duration</span>
                  </label>
                  <select
                    value={tripMinutes}
                    onChange={(e) => setTripMinutes(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-white outline-none"
                  >
                    <option value={10}>10 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={20}>20 minutes</option>
                    <option value={25}>25 minutes</option>
                    <option value={35}>35 minutes</option>
                    <option value={50}>50 minutes</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1">
                    <Bell className="w-3.5 h-3.5 text-teal-400" />
                    <span>Check-in Interval</span>
                  </label>
                  <select
                    value={checkInMinutes}
                    onChange={(e) => setCheckInMinutes(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-white outline-none"
                  >
                    <option value={5}>Every 5 minutes</option>
                    <option value={8}>Every 8 minutes</option>
                    <option value={10}>Every 10 minutes</option>
                    <option value={15}>Every 15 minutes</option>
                  </select>
                </div>
              </div>

              {/* Guardian Contact Information */}
              <div className="pt-2 border-t border-slate-800/80 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-400 block">
                  Trusted Guardian Contact
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 mb-1 block">Contact Name</label>
                    <input
                      type="text"
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                      placeholder="Mom / Roommate / Partner"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 mb-1 block">Emergency Phone Number</label>
                    <input
                      type="text"
                      value={guardianPhone}
                      onChange={(e) => setGuardianPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl px-3 py-2 text-xs text-white outline-none font-mono"
                    />
                  </div>
                </div>
                {trustedContacts.length > 0 ? (
                  <div className="space-y-2">
                    <span className="text-[11px] text-slate-400">Select saved trusted contacts for this journey</span>
                    {trustedContacts.map((contact) => (
                      <label key={contact.id} className="flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedContactIds.includes(contact.id)}
                          onChange={(event) => setSelectedContactIds((ids) => event.target.checked
                            ? [...ids, contact.id]
                            : ids.filter((id) => id !== contact.id))}
                          className="accent-teal-400"
                        />
                        <span>{contact.name}</span>
                        <span className="text-slate-500">{contact.email}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">No saved trusted contacts. Manage contacts in the SafeStride dashboard before starting a journey.</p>
                )}
              </div>

              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <label className="flex items-start gap-2 text-xs text-slate-200">
                  <input type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} className="mt-0.5 accent-teal-400" />
                  <span><b className="text-amber-300">Demo simulation</b><span className="block text-[10px] text-slate-400">Opt in to simulated route progress and demo controls. No messages or emergency services are involved.</span></span>
                </label>
                <label className="flex items-start gap-2 text-xs text-slate-200">
                  <input type="checkbox" checked={locationSharing} onChange={(event) => setLocationSharing(event.target.checked)} className="mt-0.5 accent-teal-400" />
                  <span><b>Share browser location</b><span className="block text-[10px] text-slate-400">Optional. Requires browser permission and works only while this page is active.</span></span>
                </label>
              </div>

              {/* Start Session CTA */}
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => { void handleStartSession(); }}
                  disabled={apiBusy}
                  className="w-full h-14 rounded-2xl bg-teal-400 hover:bg-teal-300 active:scale-[0.98] text-slate-950 font-black text-sm sm:text-base shadow-xl shadow-teal-500/25 flex items-center justify-center space-x-2 transition"
                >
                  <ShieldCheck className="w-5 h-5 stroke-[2.5]" />
                  <span>{apiBusy ? 'STARTING…' : 'START JOURNEY'}</span>
                </button>
                <p className="text-[11px] text-center text-slate-400 mt-2">
                  Check-in events are recorded by the app. Browser location is optional; no email or SMS is sent.
                </p>
              </div>

            </div>

          </div>
        )}

        {/* -------------------------------------------------------------
            PAGE 2: TRAVELER VIEW (Active Journey with Live Free OSM Map)
           ------------------------------------------------------------- */}
        <div hidden={!isMapPanelVisible(activeTab, 'traveler')} className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[600px] animate-fadeIn">
            
            {/* Left Column (Desktop 5 cols): Journey Status & Controls */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
              
              {/* Trip Overview & Status Card */}
              <div className={`p-5 rounded-3xl border transition-all duration-300 ${
                journeyState === 'running' 
                  ? 'bg-slate-900/90 border-slate-800' :
                journeyState === 'checkin_due' 
                  ? 'bg-amber-950/40 border-amber-500 shadow-xl shadow-amber-950/30' :
                journeyState === 'grace_period'
                  ? 'bg-orange-950/60 border-orange-500 shadow-xl shadow-orange-950/40' :
                journeyState === 'escalated'
                  ? 'bg-rose-950/70 border-rose-500 shadow-xl shadow-rose-950/40' :
                journeyState === 'sos'
                  ? 'bg-rose-900 border-rose-400 animate-pulse' :
                  'bg-emerald-950/50 border-emerald-500/60'
              }`}>
                
                {/* Status Pill & Action */}
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full flex items-center space-x-2 ${
                    journeyState === 'running' ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30' :
                    journeyState === 'checkin_due' ? 'bg-amber-500/20 text-amber-200 border border-amber-500' :
                    journeyState === 'grace_period' ? 'bg-orange-500/25 text-orange-200 border border-orange-500' :
                    journeyState === 'escalated' || journeyState === 'sos' ? 'bg-rose-500/30 text-rose-200 border border-rose-500' :
                    'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      journeyState === 'running' ? 'bg-teal-400 animate-pulse' :
                      journeyState === 'checkin_due' ? 'bg-amber-400' :
                      journeyState === 'grace_period' ? 'bg-orange-400 animate-ping' :
                      journeyState === 'escalated' || journeyState === 'sos' ? 'bg-rose-400 animate-pulse' :
                      'bg-emerald-400'
                    }`} />
                    <span>
                      {journeyState === 'running' && 'Journey in Progress'}
                      {journeyState === 'checkin_due' && 'Check-in Due'}
                      {journeyState === 'grace_period' && `Awaiting Response (${graceSecondsLeft}s)`}
                      {journeyState === 'escalated' && (demoMode ? 'Demo Escalation Simulated' : 'Escalation Recorded (SMS not enabled)')}
                      {journeyState === 'sos' && (demoMode ? 'Demo SOS Simulated' : 'SOS Recorded (no emergency services contacted)')}
                      {journeyState === 'completed' && 'Safely Completed'}
                    </span>
                  </span>

                  <button
                    onClick={handleResetToSetup}
                    className="text-[11px] text-slate-400 hover:text-teal-400 underline"
                  >
                    Edit / End Trip
                  </button>
                </div>

                {/* Origin to Destination */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-start space-x-2 text-xs text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-slate-500 mt-1" />
                    <span className="truncate">{origin}</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <MapPin className="w-4 h-4 text-teal-400 mt-0.5 flex-shrink-0" />
                    <h2 className="text-lg font-bold text-white tracking-tight leading-snug">{destination}</h2>
                  </div>
                </div>

                {/* Route Progress Bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                    <span>{demoMode ? 'Simulated Route Progress' : 'Route Progress'}</span>
                    <span>{demoMode ? `${Math.round(progressRatio * 100)}%` : 'Unavailable'}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-teal-400 h-full rounded-full transition-all duration-500"
                      style={{ width: demoMode ? `${progressRatio * 100}%` : '0%' }}
                    />
                  </div>
                </div>

                {/* Timers */}
                <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-800">
                  <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Est. Arrival In</span>
                    <span className="text-2xl lg:text-3xl font-black font-mono text-white">
                      {formatMinSec(tripSecondsLeft)}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Next Check-In</span>
                    <span className="text-2xl lg:text-3xl font-black font-mono text-teal-400">
                      {journeyState === 'grace_period' ? `${graceSecondsLeft}s` : formatMinSec(checkInSecondsLeft)}
                    </span>
                  </div>
                </div>

                {/* Vehicle & Guardian Badge */}
                <div className="mt-3 flex items-center justify-between text-xs text-slate-300 bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80">
                  <div className="flex items-center space-x-2 truncate">
                    <Car className="w-3.5 h-3.5 text-teal-400" />
                    <span className="truncate">{vehiclePlate}</span>
                  </div>
                  <div className="flex items-center space-x-1 font-mono text-emerald-400">
                    <Battery className="w-3.5 h-3.5" />
                    <span>{phoneBattery === null ? 'Unavailable' : `${phoneBattery}%`}</span>
                  </div>
                </div>

              </div>

              {/* Escalation Alert Box (if triggered) */}
              {journeyState === 'escalated' && (
                <div className="p-4 bg-rose-950/70 border border-rose-500 rounded-3xl space-y-2.5 animate-fadeIn">
                  <div className="flex items-center space-x-2 text-rose-300">
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                    <h3 className="text-sm font-bold">{demoMode ? 'Demo escalation simulated' : 'Escalation recorded — SMS not enabled'}</h3>
                  </div>
                  <p className="text-xs text-rose-200/90 font-mono bg-black/40 p-2.5 rounded-2xl border border-rose-900">
                    {demoMode
                      ? `Demo alert preview for ${guardianName || 'your selected trusted contact'} on the way to ${destination}. No message was sent.`
                      : `Missed check-in for the journey to ${destination}. Notification delivery is simulated and no SMS was sent.`}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={handleImSafe}
                      className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-600 transition"
                    >
                      Disarm Alert
                    </button>
                    <a
                      href="tel:112"
                      className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold text-center flex items-center justify-center space-x-1 transition"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Dial 112</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Thumb Zone & Desktop Traveler Actions */}
              {journeyState !== 'completed' ? (
                <div className="space-y-3">
                  
                  {/* Primary 1-Tap Check-In */}
                  <button
                    onClick={handleImSafe}
                    className="w-full h-14 lg:h-16 rounded-2xl bg-teal-400 hover:bg-teal-300 active:scale-[0.98] text-slate-950 font-black text-sm lg:text-base shadow-lg shadow-teal-500/25 flex items-center justify-center space-x-2 transition"
                  >
                    <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
                    <span>I'M SAFE • CONFIRM CHECK-IN</span>
                  </button>

                  {/* Secondary Actions */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      onClick={() => handleAddDelay(10)}
                      className="h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center justify-center space-x-1.5 transition"
                    >
                      <Clock className="w-4 h-4 text-amber-400" />
                      <span>Running Late (+10m)</span>
                    </button>
                    <button
                      onClick={handleArrivedSafely}
                      className="h-12 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 active:scale-95 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center justify-center space-x-1.5 transition"
                    >
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>Arrived Safely</span>
                    </button>
                  </div>

                  {/* Slide-to-Activate SOS */}
                  <div className="pt-1">
                    <div 
                      ref={sosTrackRef}
                      onMouseMove={handleTouchMove}
                      onMouseUp={handleTouchEnd}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      className="h-14 bg-rose-950/40 border border-rose-500/40 rounded-2xl p-1 relative flex items-center overflow-hidden"
                    >
                      <span className="w-full text-center text-xs font-bold tracking-wider uppercase text-rose-300/80 pointer-events-none pl-12">
                        Slide to Trigger SOS Distress
                      </span>

                      <div
                        onMouseDown={() => setIsDraggingSos(true)}
                        onTouchStart={() => setIsDraggingSos(true)}
                        style={{ transform: `translateX(${sosSlideOffset}px)` }}
                        className="absolute left-1 top-1 bottom-1 w-12 bg-rose-600 hover:bg-rose-500 rounded-xl flex items-center justify-center shadow-md shadow-rose-950 text-white cursor-grab active:cursor-grabbing transition-transform duration-75"
                      >
                        <AlertOctagon className="w-5 h-5 animate-pulse" />
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">
                      {demoMode
                        ? 'Demo SOS only; no contacts or emergency services are contacted.'
                        : 'Records an SOS event. Notifications are simulated; this does not send SMS or contact emergency services.'}
                    </p>
                  </div>

                </div>
              ) : (
                /* Completed State Card */
                <div className="p-6 bg-slate-900 border border-emerald-500/40 rounded-3xl text-center space-y-3">
                  <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-white">Journey Successfully Completed</h3>
                  <p className="text-xs text-slate-400">
                    Safe arrival confirmed. No message was sent to {guardianName || 'your trusted contact'}; journey timers have been stopped.
                  </p>
                  <button
                    onClick={handleResetToSetup}
                    className="w-full py-3 bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-xs rounded-2xl transition"
                  >
                    Plan Another Journey
                  </button>
                </div>
              )}

            </div>

            {/* Right Column (Desktop 7 cols): Live OSM Map + Safe Havens */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              
              {/* Interactive OpenStreetMap Container */}
              <div className="relative flex-1 min-h-[380px] lg:min-h-[460px] rounded-3xl overflow-hidden border border-slate-800 bg-slate-900 shadow-xl">
                
                {/* Map DOM Element */}
                <div ref={travelerMapRef} className="w-full h-full z-10" />

                {/* Map Floating Telemetry HUD */}
                <div className="absolute top-3 left-3 z-20 bg-slate-950/85 backdrop-blur-md border border-slate-800 p-2.5 rounded-2xl flex items-center space-x-3 text-xs shadow-lg">
                  <div className="flex items-center space-x-1.5 text-teal-400">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    <span className="font-semibold">{demoMode ? currentPos ? 'Simulated Route Position' : 'Demo Route Unavailable' : currentPos ? 'Browser GPS Position' : 'Address Route · GPS Off'}</span>
                  </div>
                  <span className="text-slate-600">|</span>
                  <div className="text-slate-300 font-mono text-[11px]">
                    {currentPos ? `${currentPos[0].toFixed(4)}°, ${currentPos[1].toFixed(4)}°` : 'No location report'}
                  </div>
                </div>
                {routeStatus === 'loading' && <div className="absolute top-16 left-3 z-20 rounded-xl bg-slate-950/90 border border-slate-700 px-3 py-2 text-xs text-slate-300" role="status">Updating address route…</div>}
                {routeStatus === 'error' && <div className="absolute top-16 left-3 z-20 max-w-[80%] rounded-xl bg-rose-950/95 border border-rose-500/60 px-3 py-2 text-xs text-rose-200" role="alert">{routeError}</div>}

                {/* Map Legend Overlay */}
                <div className="absolute bottom-3 right-3 z-20 bg-slate-950/85 backdrop-blur-md border border-slate-800 p-2.5 rounded-2xl text-[11px] space-y-1 shadow-lg hidden sm:block">
                  <div className="font-semibold text-slate-200">{visibleSafeHavens.length ? 'Illustrative demo places (unverified):' : 'No verified safe-place data available'}</div>
                  {visibleSafeHavens.length > 0 && <div className="flex items-center space-x-2 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span>Police & Women Kiosk</span>
                  </div>}
                  {visibleSafeHavens.length > 0 && <div className="flex items-center space-x-2 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span>24/7 Hospital & Clinic</span>
                  </div>}
                </div>

              </div>

              {/* Demonstration Safe Havens Strip */}
              {visibleSafeHavens.length > 0 && <p className="text-[10px] text-amber-300">Illustrative demo places only — not verified or endorsed. Check local sources for real services.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {visibleSafeHavens.map(haven => (
                  <div 
                    key={haven.id} 
                    className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-2.5">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                        haven.type === 'police' ? 'bg-blue-500/20 text-blue-400' :
                        haven.type === 'hospital' ? 'bg-rose-500/20 text-rose-400' :
                        'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {haven.type === 'police' && <Shield className="w-4 h-4" />}
                        {haven.type === 'hospital' && <HeartPulse className="w-4 h-4" />}
                        {haven.type === 'safezone' && <Building className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-200 truncate max-w-[130px]">{haven.name}</p>
                        <p className="text-[10px] text-slate-400">{haven.dist} away</p>
                      </div>
                    </div>
                    <a
                      href="tel:112"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-400 transition"
                      title="Quick Connect"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>

            </div>

          </div>

        {/* -------------------------------------------------------------
            PAGE 3: LOCAL GUARDIAN PREVIEW
           ------------------------------------------------------------- */}
        <div hidden={!isMapPanelVisible(activeTab, 'guardian')} className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[600px] animate-fadeIn">
            
            {/* Left Column (Desktop 5 cols): Guardian Telemetry & Controls */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
              
              <div className="space-y-4">
                {/* Guardian Header Pill */}
                <div className="p-4 rounded-3xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                      <Eye className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white">Guardian Preview</h2>
                      <p className="text-xs text-indigo-300">Local view in this browser; not a separate guardian feed</p>
                    </div>
                  </div>
                  <button
                    onClick={copyShareLink}
                    className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs flex items-center space-x-1"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Status overview */}
                <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Journey Status</span>
                  
                  <div className="flex items-center space-x-2 text-base font-bold text-white">
                    <span className={`w-3 h-3 rounded-full ${
                      journeyState === 'running' ? 'bg-teal-400 animate-pulse' :
                      journeyState === 'checkin_due' || journeyState === 'grace_period' ? 'bg-amber-400' :
                      journeyState === 'escalated' || journeyState === 'sos' ? 'bg-rose-500 animate-ping' :
                      'bg-emerald-400'
                    }`} />
                    <span>
                      {journeyState === 'running' && 'Traveling On Schedule • Normal'}
                      {journeyState === 'checkin_due' && 'Check-in Prompted • Waiting Response'}
                      {journeyState === 'grace_period' && `Grace Period Active (${graceSecondsLeft}s)`}
                      {journeyState === 'escalated' && (demoMode ? 'MISSED CHECK-IN: DEMO ESCALATION' : 'MISSED CHECK-IN: SIMULATED NOTIFICATION')}
                      {journeyState === 'sos' && (demoMode ? 'DEMO SOS SIMULATED' : 'SOS EVENT RECORDED')}
                      {journeyState === 'completed' && 'Arrived Safely at Destination'}
                      {journeyState === 'idle' && 'No Active Session'}
                    </span>
                  </div>

                  {/* Telemetry row */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Device battery</span>
                      <span className="font-mono font-bold text-emerald-400">{phoneBattery === null ? 'Unavailable' : `${phoneBattery}%`}</span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">{demoMode ? 'Demo speed' : 'GPS speed'}</span>
                      <span className="font-mono font-bold text-teal-300">
                        {demoMode ? '26 km/h · simulated' : travelSpeed === null ? 'Unavailable' : `${travelSpeed} km/h`}
                      </span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Est. Left</span>
                      <span className="font-mono font-bold text-white">{formatMinSec(tripSecondsLeft)}</span>
                    </div>
                  </div>

                  {/* Trip Parameters */}
                  <div className="space-y-1.5 text-xs text-slate-300 pt-1">
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Destination:</span>
                      <span className="font-semibold text-white truncate max-w-[200px]">{destination}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Transit Info:</span>
                      <span className="font-mono text-teal-300">{vehiclePlate}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">{demoMode ? 'Demo coordinates:' : 'Browser GPS:'}</span>
                      <span className="font-mono text-slate-300">{currentPos ? `${currentPos[0].toFixed(4)}°, ${currentPos[1].toFixed(4)}°` : 'Unavailable'}</span>
                    </div>
                  </div>

                </div>

                {/* Live Safety Audit Log */}
                <div className="p-4 rounded-3xl bg-slate-900 border border-slate-800 space-y-2">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Journey Timeline</h3>
                  <div className="space-y-2 max-h-36 overflow-y-auto pr-1 text-xs font-mono">
                    {eventLogs.length === 0 ? (
                      <p className="text-slate-500 text-[11px]">No events recorded yet. Start a journey session to begin logs.</p>
                    ) : (
                      eventLogs.map((log, idx) => (
                        <div key={idx} className="flex items-start space-x-2 text-[11px]">
                          <span className="text-slate-500 whitespace-nowrap">{log.time}</span>
                          <span className={
                            log.status === 'danger' ? 'text-rose-400 font-semibold' :
                            log.status === 'warning' ? 'text-amber-400' :
                            log.status === 'safe' ? 'text-emerald-400' : 'text-slate-300'
                          }>
                            {log.text}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Guardian Immediate Action Dialers */}
              <div className="space-y-2 pt-2">
                <div className="grid grid-cols-2 gap-2.5">
                  <a
                    href="tel:112"
                    className="h-13 py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-rose-950 transition"
                  >
                    <AlertOctagon className="w-4 h-4" />
                    <span>Call Police (112)</span>
                  </a>
                  <a
                    href={`tel:${guardianPhone}`}
                    className="h-13 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs flex items-center justify-center space-x-2 border border-slate-700 transition"
                  >
                    <Phone className="w-4 h-4 text-teal-400" />
                    <span>Call Listed Contact</span>
                  </a>
                </div>
              </div>

            </div>

            {/* Right Column (Desktop 7 cols): Guardian journey map */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              <div className="relative flex-1 min-h-[380px] lg:min-h-[520px] rounded-3xl overflow-hidden border border-slate-800 bg-slate-900 shadow-xl">
                
                {/* Guardian Map DOM */}
                <div ref={guardianMapRef} className="w-full h-full z-10" />

                {/* Floating GPS Beacon HUD */}
                <div className="absolute top-3 left-3 z-20 bg-slate-950/85 backdrop-blur-md border border-slate-800 p-2.5 rounded-2xl flex items-center space-x-3 text-xs shadow-lg">
                  <div className="flex items-center space-x-1.5 text-indigo-400">
                    <Compass className="w-3.5 h-3.5 animate-spin" />
                    <span className="font-semibold">{demoMode ? 'Simulated demo position' : 'Last reported browser position'}</span>
                  </div>
                  <span className="text-slate-600">|</span>
                  <div className="text-slate-300 font-mono text-[11px]">
                    Last reported: {lastLocationAt ? lastLocationAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No GPS update'}
                  </div>
                </div>

              </div>
            </div>

          </div>

      </main>

      {/* ==============================================================
          CHECK-IN DUE INTERCEPTOR MODAL / BOTTOM SHEET
         ============================================================== */}
      {(journeyState === 'checkin_due' || journeyState === 'grace_period') && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-md bg-slate-950 border-2 border-amber-500/80 rounded-3xl p-5 shadow-2xl animate-slideUp space-y-4">
            
            <div className="text-center space-y-1">
              <div className="w-12 h-12 bg-amber-500/20 text-amber-400 rounded-2xl mx-auto flex items-center justify-center mb-2">
                <Bell className="w-6 h-6 animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-white">Routine Check-in: Are you safe?</h3>
              <p className="text-xs text-slate-300">
                Confirm your status. {demoMode ? 'This is a demo; no contacts are notified.' : 'SMS is not enabled; notification delivery is simulated.'} Grace period:
              </p>
              <div className="text-4xl font-black font-mono text-amber-400 pt-1">
                {graceSecondsLeft}s
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-2 pt-2">
              <button
                onClick={handleImSafe}
                className="w-full h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 transition active:scale-98"
              >
                <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
                <span>YES, I'M SAFE</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleAddDelay(10)}
                  className="h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center justify-center space-x-1.5 transition"
                >
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>Delayed (+10m)</span>
                </button>
                <button
                  onClick={handleTriggerSos}
                  className="h-12 rounded-2xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center justify-center space-x-1.5 transition"
                >
                  <AlertOctagon className="w-4 h-4 text-rose-400" />
                  <span>Feeling Uneasy</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}