export const name = 'wind at 500 mb';

export { metadata } from './gfs-wind-10-m.js';

export const grib2_options = {
  match: ':(U|V)GRD:500 mb',
  uMatch: ":UGRD:500 mb",
  vMatch: ":VGRD:500 mb",
  limit: 2,
};
