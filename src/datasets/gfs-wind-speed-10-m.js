export const name = "wind speed at 10 m above ground";

export const metadata = {
  originalUnit: "m/s",
};

export { grib2_options } from "./gfs-wind-10-m.js";
export { grib2_speed as convert } from "../file-conversions.js";
