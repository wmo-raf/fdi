export const name = "sunshine in previous hour";

export const metadata = {
  unit: "s",
};

export const grib2_options = {
  match: ":SUNSD:surface",
};

export const accumulation = {
  reset: 6,
};
