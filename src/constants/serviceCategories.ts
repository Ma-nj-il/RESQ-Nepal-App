import { AmbulanceCategory } from '../types';

/**
 * The two RESQ Nepal service categories.
 *
 * These names, descriptions and capabilities mirror the definitions already
 * used across the app (see `src/constants/fares.ts` for pricing and the
 * equipment lists in the booking screens). Centralised here so the service
 * cards, details and confirmation screens all describe the categories the
 * same way.
 */
export interface ServiceCategory {
  key: AmbulanceCategory;
  /** Display name, matching the product copy used for driver registration. */
  name: string;
  /** Short line for compact cards. */
  tagline: string;
  /** One-paragraph explanation of when to choose this service. */
  description: string;
  /** Verified on-board capabilities for this category. */
  capabilities: string[];
  /** Short badge label. */
  badge: string;
  /** Emergency styling (dark red) vs standard styling. */
  emergency: boolean;
}

export const SERVICE_CATEGORIES: Record<AmbulanceCategory, ServiceCategory> = {
  basic: {
    key: 'basic',
    name: 'Basic Patient Delivery',
    tagline: 'Routine transport & non-ICU transfers',
    description:
      'For stable patients travelling to a hospital, clinic or home. Carries a stretcher, oxygen and first-aid equipment — not intensive-care equipment.',
    capabilities: ['Stretcher', 'Oxygen cylinder', 'First aid kit', 'Trained driver'],
    badge: 'Basic',
    emergency: false,
  },
  icu: {
    key: 'icu',
    name: 'ICU / Emergency Ambulance',
    tagline: 'Emergency transport with clinical equipment',
    description:
      'For emergency or critical transport that needs monitored care on the way to hospital. Carries intensive-care equipment with the vehicle.',
    capabilities: [
      'Stretcher',
      'Oxygen cylinder',
      'Ventilator',
      'Defibrillator',
      'Cardiac monitor',
    ],
    badge: 'ICU',
    emergency: true,
  },
};

export const SERVICE_CATEGORY_LIST: ServiceCategory[] = [
  SERVICE_CATEGORIES.basic,
  SERVICE_CATEGORIES.icu,
];
