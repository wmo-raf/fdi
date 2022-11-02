export const name = "total precipitable water";

export const metadata = {
  unit: "kg/m^2",
};

export const grib2_options = {
  match: ":PWAT:entire atmosphere",
};
