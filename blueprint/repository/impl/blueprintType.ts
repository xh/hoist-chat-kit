import {throwIf} from '@xh/hoist/utils/js';

/** Throw unless a repository's type is a dotted name of at most 50 characters. */
export function checkBlueprintType(type: string) {
    throwIf(!type, 'A blueprint repository needs a type, such as acme.dashboard.');
    throwIf(
        !type.includes('.'),
        `A blueprint type is dotted, such as acme.dashboard, not '${type}'.`
    );
    throwIf(type.length > 50, `A blueprint type is at most 50 characters: '${type}'.`);
}
