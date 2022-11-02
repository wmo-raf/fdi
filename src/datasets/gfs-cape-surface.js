export const name = `convective available potential energy at surface`;

export const metadata = {
  unit: "J/kg",
};

export const grib2_options = {
  match: ":CAPE:surface",
};
