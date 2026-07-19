Voici un exemple d'url de tuile d'un acte des archives du pas-de-calais

https://archivesenligne.pasdecalais.fr/cache/mnt_lustre_ad62_etat_civil_registres_3_510_frad062_3e_510_105_frad062_3e_510_105_0064_1080_1080_0_0_891_891_0_0_0_0.jpg

On est sur une tuile de la vue 64 du document de côte 3 E 510/105

Cette tuile correspond à celle la plus en haut à gauche de la page pour un zoom de 100%

Si j'appelle l'url directement, j'ai une 404

Mais si j'appelle d'abord cette url

https://archivesenligne.pasdecalais.fr/v2/images/genereImage.html?l=891&h=891&ol=1080&oh=1080&x=0&y=0&r=0&n=0&b=0&c=0&o=TILE&id=tuile_64_4_3_4&image=%2Fmnt%2Flustre%2Fad62%2Fetat_civil_registres_3%2F510%2Ffrad062_3e_510_105%2Ffrad062_3e_510_105_0064.jpg

Qui me retourne en corps ce résultat

7 /cache/mnt_lustre_ad62_etat_civil_registres_3_510_frad062_3e_510_105_frad062_3e_510_105_0064_1080_1080_0_0_891_891_0_0_0_0.jpg 1080 1080 4455 3140 tuile_64_4_3_4

L'url https://archivesenligne.pasdecalais.fr/cache/mnt_lustre_ad62_etat_civil_registres_3_510_frad062_3e_510_105_frad062_3e_510_105_0064_1080_1080_0_0_891_891_0_0_0_0.jpg sert l'image.


Si j'appelle 

https://archivesenligne.pasdecalais.fr/v2/images/genereImage.html?l=4455&h=3140&ol=1080&oh=1080&x=0&y=0&r=0&n=0&b=0&c=0&o=TILE&id=tuile_64_4_3_4&image=%2Fmnt%2Flustre%2Fad62%2Fetat_civil_registres_3%2F510%2Ffrad062_3e_510_105%2Ffrad062_3e_510_105_0064.jpg

j'ai ensuite accès à 

https://archivesenligne.pasdecalais.fr/cache/mnt_lustre_ad62_etat_civil_registres_3_510_frad062_3e_510_105_frad062_3e_510_105_0064_1080_1080_0_0_4455_3140_0_0_0_0.jpg

qui correspond à la vue entière mais avec un zoom moindre

J'aimerais soit trouvé le moyen via un script d'avoir la page complète où sa moitié, ou une largeur à donner mais avec un zoom similaire à la premère url

Soit un script qui construit la page avec un zoom suffisant et colle les tuiles une à une



5 MIR 510/1
VUE 100

https://archivesenligne.pasdecalais.fr/v2/images/genereImage.html?r=0&n=0&b=0&c=0&o=IMG&id=visu_image_100&image=%2Fmnt%2Flustre%2Fad62%2Fetat_civil_registres_3%2F510%2Ffrad062_5mir_510_01%2Ffrad062_5mir_510_01_0023a076.jpg

https://archivesenligne.pasdecalais.fr/cache/mnt_lustre_ad62_etat_civil_registres_3_510_frad062_5mir_510_01_frad062_5mir_510_01_0023a076_1800_1800_0_0_0_0_img.jpg