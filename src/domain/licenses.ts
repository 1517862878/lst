import type { PhotoLicense } from './types'

export interface LicenseDescriptor {
  label: string
  shortLabel: string
  summary: string
  url: string | null
  schemaUrl: string
}

export const LICENSE_DESCRIPTORS: Record<PhotoLicense, LicenseDescriptor> = {
  all_rights_reserved: {
    label: '保留所有权利',
    shortLabel: '版权所有',
    summary: '未经作者明确许可，不得复制、转载或改编。',
    url: null,
    schemaUrl: 'https://schema.org/AllRightsReserved',
  },
  cc_by: {
    label: 'CC BY 4.0（署名）',
    shortLabel: 'CC BY 4.0',
    summary: '允许分享和改编，但必须给出适当署名。',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    schemaUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  cc_by_nc: {
    label: 'CC BY-NC 4.0（署名-非商业）',
    shortLabel: 'CC BY-NC 4.0',
    summary: '允许非商业分享和改编，但必须给出适当署名。',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    schemaUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  cc_by_nc_nd: {
    label: 'CC BY-NC-ND 4.0（署名-非商业-禁止演绎）',
    shortLabel: 'CC BY-NC-ND 4.0',
    summary: '允许署名后的非商业原样分享，不允许发布演绎作品。',
    url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
    schemaUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  },
  cc0: {
    label: 'CC0 1.0（公共领域贡献）',
    shortLabel: 'CC0 1.0',
    summary: '作者在法律允许范围内放弃版权及相关权利。',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    schemaUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
}
