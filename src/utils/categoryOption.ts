import { Ambulance } from '../types';
import { ServiceCategory } from '../constants/serviceCategories';

/**
 * A service category (Basic / ICU) presented as an ambulance option. Used by
 * the booking flow when the user chooses a whole category instead of one of
 * the listed vehicles. Shared by the ambulance sheet and the home screen so
 * both lead to the same Service Details object.
 */
export interface CategoryOption extends Ambulance {
  isCategoryOption: true;
}

export const buildCategoryOption = (category: ServiceCategory): CategoryOption => ({
  id: `category-${category.key}`,
  driver_id: '',
  category: category.key,
  plate_number: '',
  model: category.name,
  color: '',
  status: 'offline',
  equipment: category.capabilities,
  created_at: '',
  isCategoryOption: true,
});
